import { useEffect, useMemo, useRef, useState } from "react";
import "../../styles/admin.css";
import { firebaseReady } from "../../lib/firebaseClient";
import { completeAdminSignIn, getAdminSession, onAdminAuthChange, sendAdminSignInLink, signOutAdmin } from "../../lib/admin/adminAuth";
import { assignAdminClaim, publishDraft, repairCoordinates, scheduleDraft, unpublishDraft } from "../../lib/admin/functions";
import { dispatchDraftToPublic, faceDraftToPublic, paperDraftToPublic, slugify } from "../../lib/admin/contentAdapters";
import { createDraft, deleteDraft as deleteDraftRecord, deleteMediaAsset as deleteMediaAssetRecord, getDraft, listVersions, restoreVersion, saveDraft, saveSectionMediaConfig, subscribeDraftList, subscribeMediaAssets, subscribeSectionMediaConfig, updateMediaAsset, uploadMediaAsset } from "../../lib/admin/repository";
import {
  AUDIENCE_LEVELS,
  CONTENT_LABELS,
  CONTENT_KINDS,
  createFaceBlock,
  createLocalId,
  createMediaValue,
  DISPATCH_TYPES,
  DRAFT_STATUSES,
  hydrateDraft,
  PAPER_TYPES,
  QUOTE_STYLES,
} from "../../lib/admin/schemas";
import { swapCoordinateValues, validateCoordinates } from "../../lib/admin/coordinates";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "faces", label: CONTENT_LABELS.faces },
  { id: "papers", label: CONTENT_LABELS.papers },
  { id: "travel", label: CONTENT_LABELS.travel },
  { id: "site-assets", label: "Site Assets" },
  { id: "media", label: "Media Library" },
];

const STATUS_TONES = {
  draft: "muted",
  review: "review",
  scheduled: "scheduled",
  published: "published",
  archived: "archived",
};

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatStamp(value, opts = {}) {
  const date = toDate(value);
  if (!date) return opts.empty || "Not set";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: opts.dateOnly ? undefined : "numeric",
    minute: opts.dateOnly ? undefined : "2-digit",
  });
}

function formatRelative(value) {
  const date = toDate(value);
  if (!date) return "";
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let current = size;
  let unitIndex = 0;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current >= 10 || unitIndex === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`;
}

function formatDateTimeLocal(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function toIsoDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function fingerprint(value) {
  return JSON.stringify(value || {});
}

function stampDraftLocally(draft, user) {
  if (!draft) return draft;
  return {
    ...draft,
    updatedAt: new Date().toISOString(),
    updatedBy: user?.email || user?.uid || draft.updatedBy || "admin",
  };
}

function stripMediaAsset(asset) {
  if (!asset) return createMediaValue();
  return {
    assetId: String(asset.id || asset.assetId || ""),
    url: String(asset.url || ""),
    alt: String(asset.alt || ""),
    title: String(asset.title || asset.fileName || asset.originalName || ""),
    caption: String(asset.caption || ""),
    storagePath: String(asset.storagePath || ""),
    contentType: String(asset.contentType || ""),
    fileName: String(asset.fileName || asset.originalName || ""),
    focusX: Number.isFinite(Number(asset.focusX)) ? Number(asset.focusX) : 50,
    focusY: Number.isFinite(Number(asset.focusY)) ? Number(asset.focusY) : 50,
  };
}

function clampPercent(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function matchesAssetType(asset, accept = "") {
  if (!accept) return true;
  const rules = accept.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!rules.length) return true;
  const type = String(asset.contentType || "");
  const fileName = String(asset.fileName || asset.originalName || "").toLowerCase();
  return rules.some((rule) => {
    if (rule === "image/*") return type.startsWith("image/");
    if (rule.startsWith(".")) return fileName.endsWith(rule.toLowerCase());
    return type === rule;
  });
}

function splitParagraphs(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function StatusPill({ status }) {
  const tone = STATUS_TONES[status] || "muted";
  return <span className={`admin-status admin-status-${tone}`}>{status}</span>;
}

function Notice({ notice, onDismiss }) {
  if (!notice) return null;
  return (
    <div className={`admin-notice admin-notice-${notice.tone || "info"}`}>
      <span>{notice.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss message">
        x
      </button>
    </div>
  );
}

function TextInput({ label, hint, value, onChange, placeholder = "", type = "text" }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
      <input className="admin-input" type={type} value={value || ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ToggleField({ label, checked, onChange, hint }) {
  return (
    <label className="admin-toggle">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

function SelectField({ label, hint, value, onChange, options }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
      <select className="admin-select" value={value || ""} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const item = typeof option === "string" ? { value: option, label: option } : option;
          return (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function TextArea({ label, hint, value, onChange, rows = 4, placeholder = "" }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
      <textarea className="admin-textarea" value={value || ""} rows={rows} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function CoordinateNotice({ longitude, latitude, onSwap }) {
  const state = validateCoordinates(longitude, latitude);
  if (!state.message) return null;
  return (
    <div className={`admin-notice admin-notice-${state.looksSwapped ? "warning" : "info"}`}>
      <span>{state.message}</span>
      {state.looksSwapped ? (
        <button type="button" className="admin-mini-button" onClick={onSwap}>
          Swap coordinates
        </button>
      ) : null}
    </div>
  );
}

function StringListEditor({ label, hint, values, onChange, addLabel = "Add item" }) {
  return (
    <section className="admin-card-section">
      <div className="admin-section-head">
        <div>
          <h3>{label}</h3>
          {hint ? <p>{hint}</p> : null}
        </div>
        <button type="button" className="admin-mini-button" onClick={() => onChange([...(values || []), ""])}>
          {addLabel}
        </button>
      </div>
      <div className="admin-stack">
        {(values || []).map((value, index) => (
          <div className="admin-inline-row" key={`${label}-${index}`}>
            <input
              className="admin-input"
              value={value || ""}
              onChange={(event) => {
                const next = [...(values || [])];
                next[index] = event.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              className="admin-icon-button"
              onClick={() => {
                const next = (values || []).filter((_, itemIndex) => itemIndex !== index);
                onChange(next.length ? next : [""]);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssetField({ label, accept, value, assets, onChange, onUpload, kind, field, hint }) {
  const inputRef = useRef(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const filteredAssets = useMemo(() => (assets || []).filter((asset) => matchesAssetType(asset, accept)).slice(0, 12), [assets, accept]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const asset = await onUpload(file, { kind, field });
      onChange(stripMediaAsset(asset));
      setLibraryOpen(false);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  const preview = value?.url ? (
    value.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(value.url) ? (
      <img src={value.url} alt={value.alt || label} className="admin-asset-preview-image" />
    ) : (
      <div className="admin-asset-preview-file">
        <strong>{value.fileName || "Attached file"}</strong>
        <span>{value.contentType || "Document"}</span>
      </div>
    )
  ) : (
    <div className="admin-asset-preview-empty">No asset selected</div>
  );

  return (
    <section className="admin-card-section">
      <div className="admin-section-head">
        <div>
          <h3>{label}</h3>
          {hint ? <p>{hint}</p> : null}
        </div>
        <div className="admin-button-row compact">
          <button type="button" className="admin-mini-button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload"}
          </button>
          <button type="button" className="admin-mini-button" onClick={() => setLibraryOpen((open) => !open)}>
            {libraryOpen ? "Hide Recent" : "Use Recent"}
          </button>
          {value?.url ? (
            <button type="button" className="admin-mini-button danger" onClick={() => onChange(createMediaValue())}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      <div className="admin-asset-preview">{preview}</div>
      <div className="admin-grid two-up">
        <TextInput label="URL" value={value?.url || ""} onChange={(next) => onChange({ ...value, url: next })} />
        <TextInput
          label="Alt text"
          hint="Describe the image for screen readers and when the image cannot load."
          value={value?.alt || ""}
          onChange={(next) => onChange({ ...value, alt: next })}
        />
        <TextInput label="Title" hint="Internal media title or display label." value={value?.title || ""} onChange={(next) => onChange({ ...value, title: next })} />
        <TextInput label="Caption" hint="Visible caption text used where the page supports it." value={value?.caption || ""} onChange={(next) => onChange({ ...value, caption: next })} />
      </div>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={handleFile} />
      {libraryOpen ? (
        <div className="admin-asset-grid">
          {filteredAssets.length ? (
            filteredAssets.map((asset) => (
              <button
                type="button"
                className="admin-asset-tile"
                key={asset.id}
                onClick={() => {
                  onChange(stripMediaAsset(asset));
                  setLibraryOpen(false);
                }}
              >
                {asset.contentType?.startsWith("image/") ? <img src={asset.url} alt={asset.alt || asset.fileName || ""} /> : <div className="admin-doc-pill">DOC</div>}
                <strong>{asset.fileName || asset.originalName || "Unnamed"}</strong>
                <span>{asset.contentType || "asset"}</span>
              </button>
            ))
          ) : (
            <p className="admin-empty-inline">No matching media in the library yet.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function FaceBlocksEditor({ blocks, onChange, onUpload, assets }) {
  function updateBlock(index, nextBlock) {
    const next = [...blocks];
    next[index] = nextBlock;
    onChange(next);
  }

  function moveBlock(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [block] = next.splice(index, 1);
    next.splice(target, 0, block);
    onChange(next);
  }

  return (
    <section className="admin-card-section">
      <div className="admin-section-head">
        <div>
          <h3>Story blocks</h3>
          <p>Build the published profile body with paragraphs, Q&amp;A, pull quotes, and photo blocks.</p>
        </div>
        <div className="admin-button-row compact">
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("paragraph")])}>Paragraph</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("qa")])}>Q&amp;A</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("quote")])}>Quote</button>
          <button type="button" className="admin-mini-button" onClick={() => onChange([...(blocks || []), createFaceBlock("photo")])}>Photo</button>
        </div>
      </div>
      <div className="admin-stack">
        {(blocks || []).map((block, index) => (
          <article className="admin-subcard" key={block.id || index}>
            <div className="admin-subcard-head">
              <strong>{block.type}</strong>
              <div className="admin-button-row compact">
                <button type="button" className="admin-mini-button" onClick={() => moveBlock(index, -1)}>Up</button>
                <button type="button" className="admin-mini-button" onClick={() => moveBlock(index, 1)}>Down</button>
                <button
                  type="button"
                  className="admin-mini-button danger"
                  onClick={() => onChange(blocks.filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              </div>
            </div>
            {block.type === "paragraph" ? <TextArea label="Paragraph" value={block.text} onChange={(next) => updateBlock(index, { ...block, text: next })} rows={5} /> : null}
            {block.type === "quote" ? <TextArea label="Pull quote" value={block.text} onChange={(next) => updateBlock(index, { ...block, text: next })} rows={4} /> : null}
            {block.type === "qa" ? (
              <div className="admin-grid single-gap">
                <TextArea label="Question" value={block.question} onChange={(next) => updateBlock(index, { ...block, question: next })} rows={3} />
                <TextArea label="Answer" value={block.answer} onChange={(next) => updateBlock(index, { ...block, answer: next })} rows={5} />
              </div>
            ) : null}
            {block.type === "photo" ? (
              <AssetField
                label="Inline photo"
                accept="image/*"
                value={block}
                assets={assets}
                onUpload={onUpload}
                onChange={(next) => updateBlock(index, { ...block, ...next })}
                kind="faces"
                field={`block-${index}`}
                hint="These images publish into the live Faces story body."
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function GalleryEditor({ label, items, onChange, onUpload, assets, kind }) {
  function updateItem(index, nextValue) {
    const next = [...items];
    next[index] = nextValue;
    onChange(next);
  }

  function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  }

  return (
    <section className="admin-card-section">
      <div className="admin-section-head">
        <div>
          <h3>{label}</h3>
          <p>Upload, reuse, and reorder visual assets for the published page.</p>
        </div>
        <button type="button" className="admin-mini-button" onClick={() => onChange([...(items || []), createMediaValue()])}>
          Add slot
        </button>
      </div>
      <div className="admin-stack">
        {(items || []).map((item, index) => (
          <article className="admin-subcard" key={`${label}-${index}`}>
            <div className="admin-subcard-head">
              <strong>Slot {String(index + 1).padStart(2, "0")}</strong>
              <div className="admin-button-row compact">
                <button type="button" className="admin-mini-button" onClick={() => move(index, -1)}>Up</button>
                <button type="button" className="admin-mini-button" onClick={() => move(index, 1)}>Down</button>
                <button
                  type="button"
                  className="admin-mini-button danger"
                  onClick={() => onChange((items || []).filter((_, itemIndex) => itemIndex !== index))}
                >
                  Remove
                </button>
              </div>
            </div>
            <AssetField
              label={`Asset ${index + 1}`}
              accept="image/*"
              value={item}
              assets={assets}
              onUpload={onUpload}
              onChange={(next) => updateItem(index, next)}
              kind={kind}
              field={`${kind}-gallery-${index}`}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function SiteAssetsForm({ config, assets, onUpload, onChange, onSave, onRepairCoordinates, saving }) {
  const authorPortrait = config.papersAuthorPortrait || createMediaValue();
  return (
    <section className="admin-editor-grid single-panel">
      <section className="admin-panel admin-editor-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Section imagery</h2>
            <p>These assets replace the remaining public placeholder portraits and hero art while keeping clean fallbacks when empty.</p>
          </div>
          <button type="button" className="admin-primary-button" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save site assets"}
          </button>
          <button type="button" className="admin-secondary-button" onClick={onRepairCoordinates} disabled={saving}>
            Repair live coordinates
          </button>
        </div>
        <div className="admin-form-stack">
          <AssetField
            label="Read the Story portrait"
            accept="image/*"
            value={config.readStoryPortrait}
            assets={assets}
            onUpload={onUpload}
            onChange={(next) => onChange({ ...config, readStoryPortrait: next })}
            kind="site"
            field="read-story-portrait"
            hint="Replaces the current placeholder portrait on the About / Read the Story page."
          />
          <AssetField
            label="Selected Papers hero image"
            accept="image/*"
            value={config.papersHeroImage}
            assets={assets}
            onUpload={onUpload}
            onChange={(next) => onChange({ ...config, papersHeroImage: next })}
            kind="site"
            field="papers-hero-image"
            hint="Used in the Selected Papers hero instead of the current thin placeholder bar."
          />
          <AssetField
            label="Selected Papers author portrait"
            accept="image/*"
            value={config.papersAuthorPortrait}
            assets={assets}
            onUpload={onUpload}
            onChange={(next) => onChange({ ...config, papersAuthorPortrait: next })}
            kind="site"
            field="papers-author-portrait"
            hint="Replaces the placeholder portrait in the author section on Selected Papers."
          />
          {authorPortrait?.url ? (
            <div className="admin-field">
              <span className="admin-field-label">Selected Papers portrait framing</span>
              <span className="admin-field-hint">Adjust what part of the portrait is visible on the public page without reuploading the image.</span>
              <div className="admin-focus-grid">
                <label className="admin-field compact">
                  <span className="admin-field-label">Horizontal focus</span>
                  <input
                    className="admin-range"
                    type="range"
                    min="0"
                    max="100"
                    value={clampPercent(authorPortrait.focusX)}
                    onChange={(event) => onChange({
                      ...config,
                      papersAuthorPortrait: {
                        ...authorPortrait,
                        focusX: clampPercent(event.target.value),
                      },
                    })}
                  />
                  <input
                    className="admin-input"
                    type="number"
                    min="0"
                    max="100"
                    value={clampPercent(authorPortrait.focusX)}
                    onChange={(event) => onChange({
                      ...config,
                      papersAuthorPortrait: {
                        ...authorPortrait,
                        focusX: clampPercent(event.target.value),
                      },
                    })}
                  />
                </label>
                <label className="admin-field compact">
                  <span className="admin-field-label">Vertical focus</span>
                  <input
                    className="admin-range"
                    type="range"
                    min="0"
                    max="100"
                    value={clampPercent(authorPortrait.focusY)}
                    onChange={(event) => onChange({
                      ...config,
                      papersAuthorPortrait: {
                        ...authorPortrait,
                        focusY: clampPercent(event.target.value),
                      },
                    })}
                  />
                  <input
                    className="admin-input"
                    type="number"
                    min="0"
                    max="100"
                    value={clampPercent(authorPortrait.focusY)}
                    onChange={(event) => onChange({
                      ...config,
                      papersAuthorPortrait: {
                        ...authorPortrait,
                        focusY: clampPercent(event.target.value),
                      },
                    })}
                  />
                </label>
              </div>
              <div className="admin-focus-preview">
                <img
                  src={authorPortrait.url}
                  alt={authorPortrait.alt || authorPortrait.title || "Selected Papers portrait preview"}
                  style={{ objectPosition: `${clampPercent(authorPortrait.focusX)}% ${clampPercent(authorPortrait.focusY)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function FacePreview({ draft }) {
  const preview = faceDraftToPublic(draft);
  return (
    <section className="admin-preview-shell face-preview">
      <div className="admin-preview-hero">
        {preview.portraitUrl ? <img src={preview.portraitUrl} alt={preview.portraitAlt || preview.name} /> : <div className="admin-preview-placeholder">Portrait</div>}
        <div>
          <p className="admin-preview-kicker">{preview.city}, {preview.country}</p>
          <h2>{preview.name}</h2>
          <p className="admin-preview-subtitle">{preview.descriptor || preview.subtitle || "Profile descriptor"}</p>
          <p className="admin-preview-copy">{preview.excerpt || "Add an excerpt to see the live card treatment."}</p>
        </div>
      </div>
      {preview.facts?.length ? (
        <div className="admin-chip-row">
          {preview.facts.map((fact) => <span key={fact} className="admin-chip">{fact}</span>)}
        </div>
      ) : null}
      <div className="admin-preview-body">
        {preview.article.map((block, index) => {
          if (block.type === "qa") {
            return (
              <div className="admin-preview-qa" key={`qa-${index}`}>
                <strong>{block.q}</strong>
                <p>{block.a}</p>
              </div>
            );
          }
          if (block.type === "pull") {
            return <blockquote key={`quote-${index}`}>{block.text}</blockquote>;
          }
          if (block.type === "photo") {
            const media = preview.articlePhotos?.[block.id];
            return media?.url ? (
              <figure key={`photo-${index}`} className="admin-preview-figure">
                <img src={media.url} alt={media.alt || preview.name} />
                {media.caption ? <figcaption>{media.caption}</figcaption> : null}
              </figure>
            ) : (
              <div key={`photo-${index}`} className="admin-preview-placeholder slim">Inline photo</div>
            );
          }
          return <p key={`paragraph-${index}`}>{block.text}</p>;
        })}
      </div>
    </section>
  );
}

function PaperPreview({ draft }) {
  const preview = paperDraftToPublic(draft);
  const paragraphs = splitParagraphs(preview.bodyText).slice(0, 3);
  return (
    <section className="admin-preview-shell paper-preview">
      <div className="admin-paper-head">
        <span className="admin-preview-badge">{preview.badgeStyle || preview.type}</span>
        <h2>{preview.title || "Untitled paper"}</h2>
        {preview.subtitle ? <p className="admin-preview-subtitle">{preview.subtitle}</p> : null}
        <p className="admin-preview-meta">{preview.date || "No date"} | {preview.readTime || "1 min"} | {preview.type}</p>
      </div>
      <div className="admin-chip-row">
        {(preview.keywords || []).map((keyword) => <span key={keyword} className="admin-chip">{keyword}</span>)}
      </div>
      <div className="admin-preview-body">
        <p>{preview.summary || "Add a summary to drive the archive list and email draft later."}</p>
        {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
      <div className="admin-link-row">
        {preview.documentUrl ? <a href={preview.documentUrl} target="_blank" rel="noreferrer">Open document</a> : null}
        {preview.publicationLink ? <a href={preview.publicationLink} target="_blank" rel="noreferrer">View publication</a> : null}
      </div>
    </section>
  );
}

function TravelPreview({ draft }) {
  const preview = dispatchDraftToPublic(draft).post;
  return (
    <section className="admin-preview-shell travel-preview">
      <div className="admin-paper-head">
        <span className="admin-preview-badge">{preview.category || "dispatch"}</span>
        <h2>{preview.title || "Untitled dispatch"}</h2>
        <p className="admin-preview-meta">{preview.location || "No location"} | {preview.date || "No date"}</p>
        <p className="admin-preview-copy">{preview.preview || "Add an excerpt to see the public teaser."}</p>
      </div>
      {preview.photos?.length ? (
        <div className="admin-preview-photo-grid">
          {preview.photos.slice(0, 4).map((photo, index) => (
            <figure key={`${photo.url}-${index}`} className="admin-preview-figure compact">
              <img src={photo.url} alt={photo.caption || preview.title} />
              {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
            </figure>
          ))}
        </div>
      ) : null}
      <div className="admin-preview-body">
        {splitParagraphs(preview.full).slice(0, 3).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </div>
    </section>
  );
}

function MediaLibrary({ assets, onUpload, onSaveMetadata, onDeleteAsset }) {
  const inputRef = useRef(null);
  const [selectedId, setSelectedId] = useState("");
  const [editorState, setEditorState] = useState({ title: "", caption: "", alt: "", kind: "", field: "" });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!assets?.length) {
      setSelectedId("");
      return;
    }
    if (!selectedId || !assets.some((asset) => asset.id === selectedId)) {
      setSelectedId(assets[0].id);
    }
  }, [assets, selectedId]);

  const selectedAsset = useMemo(
    () => (assets || []).find((asset) => asset.id === selectedId) || null,
    [assets, selectedId]
  );

  useEffect(() => {
    setEditorState({
      title: selectedAsset?.title || "",
      caption: selectedAsset?.caption || "",
      alt: selectedAsset?.alt || "",
      kind: selectedAsset?.kind || "",
      field: selectedAsset?.field || "",
    });
  }, [selectedAsset]);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const asset = await onUpload(file, { kind: "library", field: "library" });
      if (asset?.id) {
        setSelectedId(asset.id);
      }
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSave() {
    if (!selectedAsset) return;
    setSaving(true);
    try {
      await onSaveMetadata(selectedAsset.id, editorState);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedAsset) return;
    const confirmed = typeof window === "undefined"
      ? true
      : window.confirm(`Delete "${selectedAsset.title || selectedAsset.fileName || "this asset"}"? This is blocked if the asset is still referenced.`);
    if (!confirmed) return;
    await onDeleteAsset(selectedAsset);
    setSelectedId("");
  }

  return (
    <section className="admin-panel media-panel-full">
      <div className="admin-panel-head">
        <div>
          <h2>Media Library</h2>
          <p>Upload once, edit captions and alt text here, then reuse the same asset across Faces, Papers, and Travel drafts.</p>
        </div>
        <div className="admin-button-row compact">
          <button type="button" className="admin-primary-button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload media"}
          </button>
        </div>
      </div>

      <input ref={inputRef} type="file" hidden accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFile} />

      {(assets || []).length ? (
        <div className="admin-media-layout">
          <div className="admin-asset-grid large">
            {assets.map((asset) => (
              <button
                type="button"
                className={`admin-asset-card admin-asset-card-button${selectedId === asset.id ? " is-active" : ""}`}
                key={asset.id}
                onClick={() => setSelectedId(asset.id)}
              >
                {asset.contentType?.startsWith("image/") ? <img src={asset.url} alt={asset.alt || asset.fileName || ""} /> : <div className="admin-doc-pill large">DOC</div>}
                <div>
                  <strong>{asset.title || asset.fileName || asset.originalName || "Unnamed asset"}</strong>
                  <p>{asset.contentType || "asset"}</p>
                  <p>{formatStamp(asset.createdAt)}</p>
                </div>
              </button>
            ))}
          </div>

          <section className="admin-card-section admin-media-editor">
            {selectedAsset ? (
              <>
                <div className="admin-section-head">
                  <div>
                    <h3>Asset Details</h3>
                    <p>Edit reusable copy and inspect the extracted file metadata.</p>
                  </div>
                  <div className="admin-button-row compact">
                    <button type="button" className="admin-mini-button primary" onClick={handleSave} disabled={saving}>
                      {saving ? "Saving..." : "Save metadata"}
                    </button>
                    <button type="button" className="admin-mini-button danger" onClick={handleDelete} disabled={saving}>
                      Delete media
                    </button>
                  </div>
                </div>

                <div className="admin-asset-preview">
                  {selectedAsset.contentType?.startsWith("image/") ? (
                    <img src={selectedAsset.url} alt={editorState.alt || selectedAsset.fileName || ""} className="admin-asset-preview-image" />
                  ) : (
                    <div className="admin-asset-preview-file">
                      <strong>{selectedAsset.fileName || "Attached file"}</strong>
                      <span>{selectedAsset.contentType || "Document"}</span>
                    </div>
                  )}
                </div>

                <div className="admin-grid two-up">
                  <TextInput label="Title" hint="Internal media title or reusable label." value={editorState.title} onChange={(next) => setEditorState((current) => ({ ...current, title: next }))} />
                  <TextInput label="Alt text" hint="Describe the image for screen readers and image fallbacks." value={editorState.alt} onChange={(next) => setEditorState((current) => ({ ...current, alt: next }))} />
                  <TextInput label="Caption" hint="Visible caption text reused when the page supports it." value={editorState.caption} onChange={(next) => setEditorState((current) => ({ ...current, caption: next }))} />
                  <TextInput label="Kind" hint="Optional organizing tag, such as travel or faces." value={editorState.kind} onChange={(next) => setEditorState((current) => ({ ...current, kind: next }))} />
                </div>
                <TextInput label="Field" hint="Optional slot label to help you remember where the asset came from." value={editorState.field} onChange={(next) => setEditorState((current) => ({ ...current, field: next }))} />

                <dl className="admin-meta-list">
                  <div><dt>File</dt><dd>{selectedAsset.fileName || selectedAsset.originalName || "Unknown"}</dd></div>
                  <div><dt>Type</dt><dd>{selectedAsset.contentType || "Unknown"}</dd></div>
                  <div><dt>Size</dt><dd>{formatBytes(selectedAsset.size)}</dd></div>
                  <div><dt>Dimensions</dt><dd>{selectedAsset.width && selectedAsset.height ? `${selectedAsset.width} x ${selectedAsset.height}` : "Unknown"}</dd></div>
                  <div><dt>Last modified</dt><dd>{selectedAsset.lastModifiedAt ? formatStamp(selectedAsset.lastModifiedAt) : "Unknown"}</dd></div>
                  <div><dt>Uploaded</dt><dd>{formatStamp(selectedAsset.createdAt)}</dd></div>
                  <div><dt>Storage path</dt><dd>{selectedAsset.storagePath || "Unknown"}</dd></div>
                </dl>
              </>
            ) : (
              <p className="admin-empty-inline">Select an asset to edit it.</p>
            )}
          </section>
        </div>
      ) : (
        <p className="admin-empty-inline">No media assets uploaded yet.</p>
      )}
    </section>
  );
}

function VersionsPanel({ versions, onRestore, loading }) {
  return (
    <section className="admin-panel admin-aside-panel">
      <div className="admin-panel-head tight">
        <div>
          <h3>Version history</h3>
          <p>Manual saves, publishes, and restores are snapshotted here.</p>
        </div>
      </div>
      <div className="admin-version-list">
        {loading ? <p className="admin-empty-inline">Loading versions...</p> : null}
        {!loading && !versions.length ? <p className="admin-empty-inline">No versions saved yet.</p> : null}
        {versions.map((version) => (
          <article className="admin-version-card" key={version.id}>
            <div>
              <strong>{version.reason || "snapshot"}</strong>
              <p>{formatStamp(version.createdAt)}</p>
              <small>{version.createdBy || "admin"}</small>
            </div>
            <button type="button" className="admin-mini-button" onClick={() => onRestore(version.id)}>Restore</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function Dashboard({ lists, onCreate, onJump }) {
  const stats = useMemo(() => {
    const byKind = CONTENT_KINDS.map((kind) => ({ kind, items: lists[kind] || [] }));
    const all = byKind.flatMap(({ kind, items }) => items.map((item) => ({ kind, ...item })));
    return {
      drafts: all.filter((item) => item.status === "draft").length,
      scheduled: all.filter((item) => item.status === "scheduled").length,
      published: all.filter((item) => item.status === "published").length,
      total: all.length,
      recent: [...all].sort((left, right) => (toDate(right.updatedAt)?.getTime() || 0) - (toDate(left.updatedAt)?.getTime() || 0)).slice(0, 6),
    };
  }, [lists]);

  return (
    <section className="admin-dashboard-grid">
      <div className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Editorial Overview</h2>
            <p>The v1 admin is focused on draft, preview, and publish control for the three live data-driven sections.</p>
          </div>
        </div>
        <div className="admin-stat-grid">
          <article className="admin-stat-card"><strong>{stats.drafts}</strong><span>Drafts in progress</span></article>
          <article className="admin-stat-card"><strong>{stats.scheduled}</strong><span>Scheduled</span></article>
          <article className="admin-stat-card"><strong>{stats.published}</strong><span>Published</span></article>
          <article className="admin-stat-card"><strong>{stats.total}</strong><span>Total admin items</span></article>
        </div>
      </div>
      <div className="admin-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Quick Actions</h2>
            <p>Create a new editorial item directly from the dashboard.</p>
          </div>
        </div>
        <div className="admin-button-grid">
          <button type="button" className="admin-primary-button" onClick={() => onCreate("faces")}>New Face</button>
          <button type="button" className="admin-primary-button" onClick={() => onCreate("papers")}>New Paper</button>
          <button type="button" className="admin-primary-button" onClick={() => onCreate("travel")}>New Dispatch</button>
        </div>
      </div>
      <div className="admin-panel full-span">
        <div className="admin-panel-head">
          <div>
            <h2>Recently touched drafts</h2>
            <p>The latest items across all editorial collections.</p>
          </div>
        </div>
        <div className="admin-recent-list">
          {stats.recent.length ? stats.recent.map((item) => (
            <button key={`${item.kind}-${item.id}`} type="button" className="admin-recent-row" onClick={() => onJump(item.kind, item.id)}>
              <div>
                <strong>{item.title || item.profileName || item.locationName || "Untitled"}</strong>
                <p>{CONTENT_LABELS[item.kind]} | {formatRelative(item.updatedAt)}</p>
              </div>
              <StatusPill status={item.status || "draft"} />
            </button>
          )) : <p className="admin-empty-inline">No drafts created yet.</p>}
        </div>
      </div>
    </section>
  );
}

function CollectionList({ kind, items, selectedId, onSelect, onCreate }) {
  return (
    <section className="admin-panel admin-list-panel">
      <div className="admin-panel-head">
        <div>
          <h2>{CONTENT_LABELS[kind]}</h2>
          <p>{items.length} draft{items.length === 1 ? "" : "s"}</p>
        </div>
        <button type="button" className="admin-mini-button primary" onClick={() => onCreate(kind)}>New</button>
      </div>
      <div className="admin-list-scroll">
        {items.length ? items.map((item) => {
          const title = item.title || item.profileName || item.locationName || "Untitled";
          return (
            <button
              type="button"
              key={item.id}
              className={`admin-list-item${selectedId === item.id ? " is-active" : ""}`}
              onClick={() => onSelect(item.id)}
            >
              <div>
                <strong>{title}</strong>
                <p>{formatRelative(item.updatedAt) || "new draft"}</p>
              </div>
              <StatusPill status={item.status || "draft"} />
            </button>
          );
        }) : <p className="admin-empty-inline">No drafts yet.</p>}
      </div>
    </section>
  );
}

function FacesForm({ draft, onChange, onUpload, assets }) {
  const coordinates = validateCoordinates(draft.longitude, draft.latitude);
  return (
    <div className="admin-form-stack">
      <section className="admin-panel">
        <div className="admin-panel-head tight"><div><h2>Profile Setup</h2><p>Canonical draft fields for the published Faces profile and its map pin.</p></div></div>
        <div className="admin-grid two-up">
          <SelectField label="Status" value={draft.status} onChange={(next) => onChange({ ...draft, status: next })} options={DRAFT_STATUSES} />
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Subtitle" value={draft.subtitle} onChange={(next) => onChange({ ...draft, subtitle: next })} />
          <TextInput
            label="Profile name"
            hint="The person's displayed name on the Faces card and story."
            value={draft.profileName}
            onChange={(next) => onChange({ ...draft, profileName: next, slug: draft.slug || slugify(next) })}
          />
          <TextInput label="Descriptor" value={draft.descriptor} onChange={(next) => onChange({ ...draft, descriptor: next })} />
          <TextInput label="Location name" value={draft.locationName} onChange={(next) => onChange({ ...draft, locationName: next })} />
          <TextInput label="Country / region" value={draft.countryRegion} onChange={(next) => onChange({ ...draft, countryRegion: next })} />
          <TextInput label="Longitude" value={draft.longitude} onChange={(next) => onChange({ ...draft, longitude: next })} />
          <TextInput label="Latitude" value={draft.latitude} onChange={(next) => onChange({ ...draft, latitude: next })} />
          <TextInput label="Publish date" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
          <TextInput label="Schedule publish" type="datetime-local" value={formatDateTimeLocal(draft.scheduledPublishAt)} onChange={(next) => onChange({ ...draft, scheduledPublishAt: toIsoDateTime(next) })} />
          <TextInput label="Age" value={draft.age} onChange={(next) => onChange({ ...draft, age: next })} />
          <TextInput label="Occupation" value={draft.occupation} onChange={(next) => onChange({ ...draft, occupation: next })} />
          <TextInput label="Religion" value={draft.religion} onChange={(next) => onChange({ ...draft, religion: next })} />
          <TextInput
            label="Slug"
            hint="URL-friendly identifier used in links and publish records, such as marrakesh-at-dawn."
            value={draft.slug}
            onChange={(next) => onChange({ ...draft, slug: slugify(next) })}
          />
        </div>
        <CoordinateNotice
          longitude={draft.longitude}
          latitude={draft.latitude}
          onSwap={() => onChange({ ...draft, ...swapCoordinateValues(draft.longitude, draft.latitude) })}
        />
        {coordinates.isValid ? <p className="admin-field-hint">Validated coordinates: {coordinates.longitude}, {coordinates.latitude}</p> : null}
        <TextArea label="Excerpt" value={draft.excerpt} onChange={(next) => onChange({ ...draft, excerpt: next })} rows={4} />
      </section>
      <AssetField label="Portrait photo" accept="image/*" value={draft.portrait} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, portrait: next })} kind="faces" field="portrait" hint="Publishes into the live card and profile portrait slot." />
      <AssetField label="Hero photo" accept="image/*" value={draft.hero} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, hero: next })} kind="faces" field="hero" hint="Reserved for future hero usage and email art direction." />
      <GalleryEditor label="Gallery" items={draft.gallery || []} onChange={(next) => onChange({ ...draft, gallery: next })} onUpload={onUpload} assets={assets} kind="faces" />
      <StringListEditor label="Callout facts / tags" values={draft.facts || []} onChange={(next) => onChange({ ...draft, facts: next })} addLabel="Add fact" />
      <section className="admin-card-section">
        <div className="admin-section-head">
          <div><h3>Featured quotes</h3><p>Saved into the canonical draft; hero/pull rendering can expand later.</p></div>
          <button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, quotes: [...(draft.quotes || []), { id: createLocalId("face-quote"), text: "", style: "pull" }] })}>Add quote</button>
        </div>
        <div className="admin-stack">
          {(draft.quotes || []).map((quote, index) => (
            <article className="admin-subcard" key={quote.id}>
              <div className="admin-subcard-head">
                <strong>Quote {index + 1}</strong>
                <button type="button" className="admin-mini-button danger" onClick={() => onChange({ ...draft, quotes: draft.quotes.filter((item) => item.id !== quote.id) })}>Remove</button>
              </div>
              <div className="admin-grid two-up">
                <SelectField label="Style" value={quote.style} onChange={(next) => onChange({ ...draft, quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, style: next } : item) })} options={QUOTE_STYLES} />
                <TextArea label="Quote text" value={quote.text} onChange={(next) => onChange({ ...draft, quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, text: next } : item) })} rows={4} />
              </div>
            </article>
          ))}
        </div>
      </section>
      <FaceBlocksEditor blocks={draft.bodyBlocks || []} onChange={(next) => onChange({ ...draft, bodyBlocks: next })} onUpload={onUpload} assets={assets} />
    </div>
  );
}

function PapersForm({ draft, onChange, onUpload, assets }) {
  return (
    <div className="admin-form-stack">
      <section className="admin-panel">
        <div className="admin-panel-head tight"><div><h2>Publication Setup</h2><p>Enough metadata to power the current archive page plus the richer publish payload.</p></div></div>
        <p className="admin-field-hint">Only items in the <strong>Published</strong> state appear on the live Selected Papers page. Saving a draft does not change the public site.</p>
        <div className="admin-grid two-up">
          <SelectField label="Status" value={draft.status} onChange={(next) => onChange({ ...draft, status: next })} options={DRAFT_STATUSES} />
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Subtitle / deck" value={draft.subtitle} onChange={(next) => onChange({ ...draft, subtitle: next })} />
          <SelectField label="Type" value={draft.type} onChange={(next) => onChange({ ...draft, type: next })} options={PAPER_TYPES} />
          <TextInput label="Badge style" value={draft.badgeStyle} onChange={(next) => onChange({ ...draft, badgeStyle: next })} />
          <TextInput label="Publish date" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
          <TextInput label="Display date override" value={draft.customDisplayDate} onChange={(next) => onChange({ ...draft, customDisplayDate: next })} />
          <TextInput label="Schedule publish" type="datetime-local" value={formatDateTimeLocal(draft.scheduledPublishAt)} onChange={(next) => onChange({ ...draft, scheduledPublishAt: toIsoDateTime(next) })} />
          <TextInput
            label="Slug"
            hint="URL-friendly identifier used in links and publish records, such as eu-policy-brief."
            value={draft.slug}
            onChange={(next) => onChange({ ...draft, slug: slugify(next) })}
          />
          <TextInput label="Publication name" value={draft.publicationName} onChange={(next) => onChange({ ...draft, publicationName: next })} />
          <TextInput label="Publication link" value={draft.publicationLink} onChange={(next) => onChange({ ...draft, publicationLink: next })} />
          <TextInput label="Read time" value={draft.readTime} onChange={(next) => onChange({ ...draft, readTime: next })} />
          <TextInput label="Featured rank" value={draft.featuredRank} onChange={(next) => onChange({ ...draft, featuredRank: next })} />
        </div>
        <div className="admin-grid two-up toggles">
          <ToggleField label="Featured paper" checked={draft.featured} onChange={(next) => onChange({ ...draft, featured: next })} />
          <ToggleField label="External publication" checked={draft.externalPublication} onChange={(next) => onChange({ ...draft, externalPublication: next })} />
        </div>
        <TextArea label="Summary" value={draft.summary} onChange={(next) => onChange({ ...draft, summary: next })} rows={5} />
        <TextArea label="Body / abstract text" value={draft.bodyText} onChange={(next) => onChange({ ...draft, bodyText: next })} rows={10} />
      </section>
      <StringListEditor label="Keywords" values={draft.keywords || []} onChange={(next) => onChange({ ...draft, keywords: next })} addLabel="Add keyword" />
      <AssetField label="Document upload" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" value={draft.document} assets={assets} onUpload={onUpload} onChange={(next) => onChange({ ...draft, document: next })} kind="papers" field="document" hint="Supports uploaded PDFs now; richer document workflows can expand later." />
    </div>
  );
}

function TravelForm({ draft, onChange, onUpload, assets }) {
  const coordinates = validateCoordinates(draft.longitude, draft.latitude);
  return (
    <div className="admin-form-stack">
      <section className="admin-panel">
        <div className="admin-panel-head tight"><div><h2>Dispatch Setup</h2><p>Canonical dispatch data publishes into Scrap Sheet posts and quote records.</p></div></div>
        <div className="admin-grid two-up">
          <SelectField label="Status" value={draft.status} onChange={(next) => onChange({ ...draft, status: next })} options={DRAFT_STATUSES} />
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput
            label="Slug"
            hint="URL-friendly identifier used in links and publish records, such as overnight-train-to-prague."
            value={draft.slug}
            onChange={(next) => onChange({ ...draft, slug: slugify(next) })}
          />
          <SelectField label="Dispatch type" value={draft.dispatchType} onChange={(next) => onChange({ ...draft, dispatchType: next })} options={DISPATCH_TYPES} />
          <SelectField label="Audience level" value={draft.audienceLevel} onChange={(next) => onChange({ ...draft, audienceLevel: next })} options={AUDIENCE_LEVELS} />
          <TextInput label="Location name" value={draft.locationName} onChange={(next) => onChange({ ...draft, locationName: next })} />
          <TextInput
            label="Time label"
            hint="Optional short display label for the dispatch, such as Dawn, 6:40 AM, or Late Night."
            value={draft.timeLabel}
            onChange={(next) => onChange({ ...draft, timeLabel: next })}
          />
          <TextInput label="Longitude" value={draft.longitude} onChange={(next) => onChange({ ...draft, longitude: next })} />
          <TextInput label="Latitude" value={draft.latitude} onChange={(next) => onChange({ ...draft, latitude: next })} />
          <TextInput label="Publish date" type="date" value={draft.publishDate} onChange={(next) => onChange({ ...draft, publishDate: next })} />
          <TextInput label="Schedule publish" type="datetime-local" value={formatDateTimeLocal(draft.scheduledPublishAt)} onChange={(next) => onChange({ ...draft, scheduledPublishAt: toIsoDateTime(next) })} />
        </div>
        <CoordinateNotice
          longitude={draft.longitude}
          latitude={draft.latitude}
          onSwap={() => onChange({ ...draft, ...swapCoordinateValues(draft.longitude, draft.latitude) })}
        />
        {coordinates.isValid ? <p className="admin-field-hint">Validated coordinates: {coordinates.longitude}, {coordinates.latitude}</p> : null}
        <ToggleField label="Pin as featured dispatch" checked={draft.pinned} onChange={(next) => onChange({ ...draft, pinned: next })} hint="The public page already honors pinned items in its current list model." />
        <TextArea label="Excerpt / preview" value={draft.excerpt} onChange={(next) => onChange({ ...draft, excerpt: next })} rows={4} />
        <TextArea label="Body text" value={draft.bodyText} onChange={(next) => onChange({ ...draft, bodyText: next })} rows={10} />
      </section>
      <GalleryEditor label="Dispatch photos" items={draft.photos || []} onChange={(next) => onChange({ ...draft, photos: next })} onUpload={onUpload} assets={assets} kind="travel" />
      <section className="admin-card-section">
        <div className="admin-section-head">
          <div><h3>Quote cards</h3><p>Each saved quote publishes into `scrap_sheet_quotes` for the current travel page experience.</p></div>
          <button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, quotes: [...(draft.quotes || []), { id: createLocalId("travel-quote"), text: "" }] })}>Add quote</button>
        </div>
        <div className="admin-stack">
          {(draft.quotes || []).map((quote) => (
            <div className="admin-inline-row" key={quote.id}>
              <textarea className="admin-textarea compact" rows={3} value={quote.text || ""} onChange={(event) => onChange({ ...draft, quotes: draft.quotes.map((item) => item.id === quote.id ? { ...item, text: event.target.value } : item) })} />
              <button type="button" className="admin-icon-button" onClick={() => onChange({ ...draft, quotes: draft.quotes.filter((item) => item.id !== quote.id) })}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PreviewPanel({ kind, draft }) {
  return (
    <section className="admin-panel admin-aside-panel">
      <div className="admin-panel-head tight">
        <div>
          <h3>Preview</h3>
          <p>Site-like render using the transformed publish model.</p>
        </div>
      </div>
      {kind === "faces" ? <FacePreview draft={draft} /> : null}
      {kind === "papers" ? <PaperPreview draft={draft} /> : null}
      {kind === "travel" ? <TravelPreview draft={draft} /> : null}
    </section>
  );
}

export default function AdminApp() {
  const [authState, setAuthState] = useState({ loading: true, user: null, claims: {}, isAdmin: false, error: "" });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [lists, setLists] = useState({ faces: [], papers: [], travel: [] });
  const [mediaAssets, setMediaAssets] = useState([]);
  const [sectionMediaConfig, setSectionMediaConfig] = useState({
    readStoryPortrait: createMediaValue(),
    papersHeroImage: createMediaValue(),
    papersAuthorPortrait: createMediaValue(),
  });
  const [selectedIds, setSelectedIds] = useState({ faces: "", papers: "", travel: "" });
  const [draft, setDraft] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [notice, setNotice] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [working, setWorking] = useState(false);
  const [saveState, setSaveState] = useState("Idle");
  const baselineRef = useRef("");
  const isContentSection = activeSection === "faces" || activeSection === "papers" || activeSection === "travel";
  const activeItems = isContentSection ? (lists[activeSection] || []) : [];
  const draftId = isContentSection ? selectedIds[activeSection] : "";
  const canEdit = authState.isAdmin && isContentSection && draftId;

  useEffect(() => {
    let active = true;
    let unsubscribeRef = null;

    async function boot() {
      if (!firebaseReady) {
        setAuthState({ loading: false, user: null, claims: {}, isAdmin: false, error: "Firebase env vars are missing." });
        return;
      }
      try {
        await completeAdminSignIn(typeof window !== "undefined" ? window.location.href : "");
      } catch (error) {
        if (active) {
          setNotice({ tone: "warning", message: error.message || "Admin sign-in could not be completed." });
        }
      }
      unsubscribeRef = onAdminAuthChange(async (user) => {
        if (!active) return;
        if (!user) {
          setAuthState({ loading: false, user: null, claims: {}, isAdmin: false, error: "" });
          return;
        }
        try {
          const session = await getAdminSession(user, false);
          if (!active) return;
          setAuthState({ loading: false, ...session, error: "" });
        } catch (error) {
          if (!active) return;
          setAuthState({ loading: false, user, claims: {}, isAdmin: false, error: error.message || "Could not inspect the admin session." });
        }
      });
    }

    boot();
    return () => {
      active = false;
      if (typeof unsubscribeRef === "function") unsubscribeRef();
    };
  }, []);

  useEffect(() => {
    if (!authState.isAdmin) return undefined;
    const unsubscribers = CONTENT_KINDS.map((kind) => subscribeDraftList(kind, (items) => {
      setLists((current) => ({ ...current, [kind]: items }));
    }, (error) => setNotice({ tone: "error", message: `${CONTENT_LABELS[kind]} failed to load: ${error.message}` })));
    const unsubscribeMedia = subscribeMediaAssets(setMediaAssets, (error) => setNotice({ tone: "error", message: `Media library failed to load: ${error.message}` }));
    const unsubscribeSectionMedia = subscribeSectionMediaConfig((config) => {
      setSectionMediaConfig({
        readStoryPortrait: config?.readStoryPortrait || createMediaValue(),
        papersHeroImage: config?.papersHeroImage || createMediaValue(),
        papersAuthorPortrait: config?.papersAuthorPortrait || createMediaValue(),
      });
    }, (error) => setNotice({ tone: "error", message: `Site assets failed to load: ${error.message}` }));
    unsubscribers.push(unsubscribeMedia, unsubscribeSectionMedia);
    return () => unsubscribers.forEach((unsubscribe) => typeof unsubscribe === "function" && unsubscribe());
  }, [authState.isAdmin]);

  useEffect(() => {
    if (!isContentSection) return undefined;
    const selectedId = selectedIds[activeSection];
    const hasSelected = selectedId && activeItems.some((item) => item.id === selectedId);
    if (hasSelected) return undefined;
    const nextId = activeItems[0]?.id || "";
    if (selectedId === nextId) return undefined;
    setSelectedIds((current) => ({ ...current, [activeSection]: nextId }));
    return undefined;
  }, [activeItems, activeSection, isContentSection, selectedIds]);

  useEffect(() => {
    if (!isContentSection) {
      setDraft(null);
      setVersions([]);
      baselineRef.current = "";
      return;
    }
    if (!draftId) {
      setDraft(null);
      setVersions([]);
      baselineRef.current = "";
      return;
    }
    let active = true;
    setLoadingDraft(true);
    setLoadingVersions(true);
    getDraft(activeSection, draftId)
      .then((loaded) => {
        if (!active) return;
        const hydrated = hydrateDraft(activeSection, loaded || {});
        setDraft(hydrated);
        baselineRef.current = fingerprint(hydrated);
      })
      .catch((error) => {
        if (active) setNotice({ tone: "error", message: error.message || "Draft could not be loaded." });
      })
      .finally(() => {
        if (active) setLoadingDraft(false);
      });
    listVersions(activeSection, draftId)
      .then((loaded) => {
        if (active) setVersions(loaded);
      })
      .catch((error) => {
        if (active) setNotice({ tone: "error", message: error.message || "Version history could not be loaded." });
      })
      .finally(() => {
        if (active) setLoadingVersions(false);
      });
    return () => {
      active = false;
    };
  }, [activeSection, draftId, isContentSection]);

  useEffect(() => {
    if (!canEdit || !draft || typeof window === "undefined") return undefined;
    const currentFingerprint = fingerprint(draft);
    if (!baselineRef.current || currentFingerprint === baselineRef.current) return undefined;
    const timeout = window.setTimeout(async () => {
      try {
        setSaveState("Autosaving...");
        await saveDraft(activeSection, draftId, draft, authState.user, { captureVersion: false, reason: "autosave" });
        baselineRef.current = currentFingerprint;
        setSaveState(`Autosaved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      } catch (error) {
        setSaveState("Autosave failed");
        setNotice({ tone: "error", message: error.message || "Autosave failed." });
      }
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [draft, canEdit, activeSection, draftId, authState.user]);

  const totals = useMemo(() => ({
    faces: lists.faces.length,
    papers: lists.papers.length,
    travel: lists.travel.length,
  }), [lists]);

  async function refreshSession(force = true) {
    if (!authState.user) return;
    const session = await getAdminSession(authState.user, force);
    setAuthState((current) => ({ ...current, ...session }));
  }

  async function handleSendLink() {
    try {
      await sendAdminSignInLink(emailInput);
      setNotice({ tone: "success", message: `Admin sign-in link sent to ${emailInput}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Could not send sign-in link." });
    }
  }

  async function handleClaimAdmin() {
    try {
      setWorking(true);
      await assignAdminClaim({});
      await refreshSession(true);
      setNotice({ tone: "success", message: "Admin claim applied. Refreshing the session now." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Admin claim could not be assigned." });
    } finally {
      setWorking(false);
    }
  }

  async function handleCreate(kind) {
    try {
      setWorking(true);
      const id = await createDraft(kind, authState.user);
      setSelectedIds((current) => ({ ...current, [kind]: id }));
      setActiveSection(kind);
      setNotice({ tone: "success", message: `${CONTENT_LABELS[kind]} draft created.` });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Draft could not be created." });
    } finally {
      setWorking(false);
    }
  }

  async function handleManualSave(reason = "manual-save") {
    if (!canEdit || !draft) return;
    try {
      setWorking(true);
      await saveDraft(activeSection, draftId, draft, authState.user, { captureVersion: true, reason });
      const hydrated = hydrateDraft(activeSection, stampDraftLocally(draft, authState.user));
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setSaveState(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      setVersions(await listVersions(activeSection, draftId));
      setNotice({ tone: "success", message: "Draft saved." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Draft save failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handlePublish() {
    if (!canEdit || !draft) return;
    if ((activeSection === "faces" || activeSection === "travel") && !validateCoordinates(draft.longitude, draft.latitude).isValid) {
      setNotice({ tone: "warning", message: "Fix the longitude and latitude before publishing. If they look reversed, use the swap button in the form." });
      return;
    }
    try {
      setWorking(true);
      await handleManualSave("pre-publish");
      const result = await publishDraft(activeSection, draftId);
      setNotice({ tone: "success", message: result?.message || "Published to the public collection." });
      const loaded = await getDraft(activeSection, draftId);
      const hydrated = hydrateDraft(activeSection, loaded || {});
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setVersions(await listVersions(activeSection, draftId));
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Publish failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleSchedule() {
    if (!canEdit || !draft?.scheduledPublishAt) {
      setNotice({ tone: "warning", message: "Set a future publish date and time before scheduling." });
      return;
    }
    if ((activeSection === "faces" || activeSection === "travel") && !validateCoordinates(draft.longitude, draft.latitude).isValid) {
      setNotice({ tone: "warning", message: "Fix the longitude and latitude before scheduling. If they look reversed, use the swap button in the form." });
      return;
    }
    try {
      setWorking(true);
      await handleManualSave("pre-schedule");
      const result = await scheduleDraft(activeSection, draftId, draft.scheduledPublishAt);
      setNotice({ tone: "success", message: result?.message || "Draft scheduled." });
      const loaded = await getDraft(activeSection, draftId);
      const hydrated = hydrateDraft(activeSection, loaded || {});
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setVersions(await listVersions(activeSection, draftId));
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Schedule failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleUnpublish() {
    if (!canEdit) return;
    try {
      setWorking(true);
      const result = await unpublishDraft(activeSection, draftId);
      setNotice({ tone: "success", message: result?.message || "Public content removed." });
      const loaded = await getDraft(activeSection, draftId);
      const hydrated = hydrateDraft(activeSection, loaded || {});
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setVersions(await listVersions(activeSection, draftId));
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Unpublish failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleRestoreVersion(versionId) {
    if (!canEdit) return;
    try {
      setWorking(true);
      const restored = await restoreVersion(activeSection, draftId, versionId, authState.user);
      const hydrated = hydrateDraft(activeSection, restored);
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setVersions(await listVersions(activeSection, draftId));
      setNotice({ tone: "success", message: "Version restored into the active draft." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Restore failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleUpload(file, context) {
    try {
      const asset = await uploadMediaAsset(file, authState.user, context);
      setNotice({ tone: "success", message: `${file.name} uploaded to the media library.` });
      return asset;
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Upload failed." });
      throw error;
    }
  }

  async function handleSaveMediaMetadata(assetId, updates) {
    try {
      setWorking(true);
      const asset = await updateMediaAsset(assetId, updates, authState.user);
      setNotice({ tone: "success", message: "Media metadata saved." });
      return asset;
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Media metadata could not be saved." });
      throw error;
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteMediaAsset(asset) {
    try {
      setWorking(true);
      await deleteMediaAssetRecord(asset, authState.user);
      setNotice({ tone: "success", message: "Media deleted." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Media could not be deleted." });
    } finally {
      setWorking(false);
    }
  }

  async function handleSaveSectionMedia() {
    try {
      setWorking(true);
      const saved = await saveSectionMediaConfig(sectionMediaConfig, authState.user);
      setSectionMediaConfig({
        readStoryPortrait: saved?.readStoryPortrait || createMediaValue(),
        papersHeroImage: saved?.papersHeroImage || createMediaValue(),
        papersAuthorPortrait: saved?.papersAuthorPortrait || createMediaValue(),
      });
      setNotice({ tone: "success", message: "Site assets saved." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Site assets could not be saved." });
    } finally {
      setWorking(false);
    }
  }

  async function handleRepairCoordinates() {
    try {
      setWorking(true);
      const result = await repairCoordinates();
      setNotice({ tone: "success", message: result?.message || "Coordinate repair completed." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Coordinate repair failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteDraft() {
    if (!canEdit || !draftId) return;
    if (draft?.status === "published" || draft?.publishedRecord?.slug) {
      setNotice({ tone: "warning", message: "Unpublish this item before deleting its draft record." });
      return;
    }
    const label = draft?.title || draft?.profileName || draft?.locationName || "this draft";
    const confirmed = typeof window === "undefined" ? true : window.confirm(`Delete "${label}"? This removes the draft and its version history.`);
    if (!confirmed) return;
    try {
      setWorking(true);
      await deleteDraftRecord(activeSection, draftId);
      baselineRef.current = "";
      setDraft(null);
      setVersions([]);
      setSelectedIds((current) => ({ ...current, [activeSection]: "" }));
      setSaveState("Idle");
      setNotice({ tone: "success", message: "Draft deleted." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Draft could not be deleted." });
    } finally {
      setWorking(false);
    }
  }

  function renderActiveForm() {
    if (!draft) return <p className="admin-empty-inline">Create or select a draft to start editing.</p>;
    if (activeSection === "faces") return <FacesForm draft={draft} onChange={(next) => setDraft(hydrateDraft("faces", next))} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "papers") return <PapersForm draft={draft} onChange={(next) => setDraft(hydrateDraft("papers", next))} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "travel") return <TravelForm draft={draft} onChange={(next) => setDraft(hydrateDraft("travel", next))} onUpload={handleUpload} assets={mediaAssets} />;
    return null;
  }

  if (authState.loading) {
    return <div className="admin-loading">Loading admin...</div>;
  }

  if (!authState.user) {
    return (
      <main className="admin-auth-shell">
        <section className="admin-auth-card">
          <p className="admin-auth-kicker">Stories From Abroad</p>
          <h1>Admin CMS</h1>
          <p className="admin-auth-copy">Passwordless Firebase sign-in for the protected editorial workspace.</p>
          <input className="admin-input" type="email" value={emailInput} placeholder="you@example.com" onChange={(event) => setEmailInput(event.target.value)} />
          <button type="button" className="admin-primary-button wide" onClick={handleSendLink}>Send admin sign-in link</button>
          <Notice notice={notice} onDismiss={() => setNotice(null)} />
          {authState.error ? <p className="admin-inline-error">{authState.error}</p> : null}
        </section>
      </main>
    );
  }

  if (!authState.isAdmin) {
    return (
      <main className="admin-auth-shell">
        <section className="admin-auth-card">
          <p className="admin-auth-kicker">Signed in as {authState.user.email}</p>
          <h1>Admin claim required</h1>
          <p className="admin-auth-copy">This account is authenticated but does not yet have the `admin` custom claim. If your email is in the bootstrap allowlist, the button below will attach it.</p>
          <div className="admin-button-row stacked">
            <button type="button" className="admin-primary-button wide" onClick={handleClaimAdmin} disabled={working}>Claim admin access</button>
            <button type="button" className="admin-secondary-button wide" onClick={() => refreshSession(true)}>Refresh session</button>
            <button type="button" className="admin-secondary-button wide" onClick={() => signOutAdmin()}>Sign out</button>
          </div>
          <Notice notice={notice} onDismiss={() => setNotice(null)} />
          {authState.error ? <p className="admin-inline-error">{authState.error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <p>Stories From Abroad</p>
          <h1>Admin CRM v1</h1>
          <span>Content-first release</span>
        </div>
        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" className={`admin-nav-item${activeSection === item.id ? " is-active" : ""}`} onClick={() => setActiveSection(item.id)}>
              <span>{item.label}</span>
              {totals[item.id] ? <small>{totals[item.id]}</small> : null}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <p>{authState.user.email}</p>
          <button type="button" className="admin-mini-button" onClick={() => signOutAdmin()}>Sign out</button>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="admin-topbar-kicker">Protected editorial workspace</p>
            <h2>{activeSection === "dashboard" ? "Dashboard" : activeSection === "media" ? "Media Library" : activeSection === "site-assets" ? "Site Assets" : CONTENT_LABELS[activeSection]}</h2>
          </div>
          <div className="admin-topbar-actions">
            {isContentSection && draft ? <StatusPill status={draft.status || "draft"} /> : null}
            {isContentSection ? <span className="admin-save-state">{saveState}</span> : null}
            {canEdit ? <button type="button" className="admin-secondary-button" onClick={() => handleManualSave()} disabled={working || loadingDraft}>Save version</button> : null}
            {canEdit ? <button type="button" className="admin-primary-button" onClick={handlePublish} disabled={working || loadingDraft}>Publish now</button> : null}
            {canEdit ? <button type="button" className="admin-secondary-button" onClick={handleSchedule} disabled={working || loadingDraft}>Schedule</button> : null}
            {canEdit ? <button type="button" className="admin-secondary-button danger" onClick={handleUnpublish} disabled={working || loadingDraft}>Unpublish</button> : null}
            {canEdit ? <button type="button" className="admin-secondary-button danger" onClick={handleDeleteDraft} disabled={working || loadingDraft}>Delete draft</button> : null}
          </div>
        </header>
        <Notice notice={notice} onDismiss={() => setNotice(null)} />
        {activeSection === "dashboard" ? <Dashboard lists={lists} onCreate={handleCreate} onJump={(kind, id) => { setActiveSection(kind); setSelectedIds((current) => ({ ...current, [kind]: id })); }} /> : null}
        {activeSection === "media" ? <MediaLibrary assets={mediaAssets} onUpload={handleUpload} onSaveMetadata={handleSaveMediaMetadata} onDeleteAsset={handleDeleteMediaAsset} /> : null}
        {activeSection === "site-assets" ? (
          <SiteAssetsForm
            config={sectionMediaConfig}
            assets={mediaAssets}
            onUpload={handleUpload}
            onChange={setSectionMediaConfig}
            onSave={handleSaveSectionMedia}
            onRepairCoordinates={handleRepairCoordinates}
            saving={working}
          />
        ) : null}
        {isContentSection ? (
          <section className="admin-editor-grid">
            <CollectionList kind={activeSection} items={lists[activeSection] || []} selectedId={draftId} onSelect={(id) => setSelectedIds((current) => ({ ...current, [activeSection]: id }))} onCreate={handleCreate} />
            <section className="admin-panel admin-editor-panel">
              <div className="admin-panel-head">
                <div>
                  <h2>{draft?.title || draft?.profileName || draft?.locationName || "Untitled draft"}</h2>
                  <p>
                    Last updated {draft?.updatedAt ? formatStamp(draft.updatedAt) : "not yet"}
                    {draft?.publishedRecord?.slug ? ` | public slug ${draft.publishedRecord.slug}` : ""}
                  </p>
                </div>
              </div>
              {loadingDraft ? <p className="admin-empty-inline">Loading draft...</p> : renderActiveForm()}
            </section>
            <div className="admin-aside-stack">
              {draft ? <PreviewPanel kind={activeSection} draft={draft} /> : null}
              <VersionsPanel versions={versions} onRestore={handleRestoreVersion} loading={loadingVersions} />
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
