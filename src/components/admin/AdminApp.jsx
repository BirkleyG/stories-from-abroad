import { useEffect, useMemo, useRef, useState } from "react";
import "../../styles/admin.css";
import { firebaseReady } from "../../lib/firebaseClient";
import { completeAdminSignIn, ensureAdminPersistence, getAdminSession, onAdminAuthChange, sendAdminSignInLink, signOutAdmin } from "../../lib/admin/adminAuth";
import { assignAdminClaim, publishDraft, repairCoordinates, scheduleDraft, unpublishDraft } from "../../lib/admin/functions";
import { dispatchDraftToPublic, faceDraftToPublic, photographyDraftToPublic, slugify } from "../../lib/admin/contentAdapters";
import { collectFeaturedPhotoOptions, mediaSummaryFromPhotos } from "../../lib/admin/photographyTemplates";
import { createDraft, deleteDraft as deleteDraftRecord, deleteMediaAsset as deleteMediaAssetRecord, getDraft, listVersions, restoreVersion, saveDraft, savePhotographyFeaturedConfig, saveSectionMediaConfig, subscribeDraftList, subscribeMediaAssets, subscribePhotographyFeaturedConfig, subscribeSectionMediaConfig, updateMediaAsset, uploadMediaAsset } from "../../lib/admin/repository";
import {
  AUDIENCE_LEVELS,
  CONTENT_LABELS,
  CONTENT_KINDS,
  createFaceBlock,
  createLocalId,
  createMediaValue,
  PHOTO_TEMPLATES,
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
  { id: "photography", label: CONTENT_LABELS.photography },
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

const ADMIN_PREVIEW_STORAGE_KEY = "sfa-admin-preview-v1";
const base = import.meta.env.BASE_URL ?? "/";
const basePath = base.endsWith("/") ? base : `${base}/`;

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

function formatDateInput(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
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
  const resolvedUrl = String(asset.url || asset.downloadURL || asset.downloadUrl || asset.src || asset.photoUrl || "").trim();
  return {
    assetId: String(asset.id || asset.assetId || ""),
    url: resolvedUrl,
    alt: String(asset.alt || ""),
    title: String(asset.title || asset.fileName || asset.originalName || ""),
    caption: String(asset.caption || ""),
    locationLabel: String(asset.locationLabel || ""),
    storagePath: String(asset.storagePath || ""),
    contentType: String(asset.contentType || ""),
    fileName: String(asset.fileName || asset.originalName || ""),
    focusX: Number.isFinite(Number(asset.focusX)) ? Number(asset.focusX) : 50,
    focusY: Number.isFinite(Number(asset.focusY)) ? Number(asset.focusY) : 50,
    width: Number.isFinite(Number(asset.width)) ? Number(asset.width) : null,
    height: Number.isFinite(Number(asset.height)) ? Number(asset.height) : null,
    cameraModel: String(asset.cameraModel || ""),
    exifDate: String(asset.exifDate || ""),
    shutter: String(asset.shutter || ""),
    aperture: String(asset.aperture || ""),
    iso: String(asset.iso || ""),
    lens: String(asset.lens || ""),
    metadataEnabled: asset?.metadataEnabled !== false,
    shortQuote: String(asset.shortQuote || ""),
  };
}

function createMediaMetadataState(asset) {
  return {
    title: String(asset?.title || ""),
    caption: String(asset?.caption || ""),
    alt: String(asset?.alt || ""),
    locationLabel: String(asset?.locationLabel || ""),
    exifDate: String(asset?.exifDate || ""),
    metadataEnabled: asset?.metadataEnabled !== false,
    shortQuote: String(asset?.shortQuote || ""),
    cameraModel: String(asset?.cameraModel || ""),
    lens: String(asset?.lens || ""),
    shutter: String(asset?.shutter || ""),
    aperture: String(asset?.aperture || ""),
    iso: String(asset?.iso || ""),
    kind: String(asset?.kind || ""),
    field: String(asset?.field || ""),
  };
}

function mediaLibraryMetadataFromPhoto(photo) {
  return {
    title: String(photo?.title || ""),
    caption: String(photo?.caption || ""),
    alt: String(photo?.alt || ""),
    locationLabel: String(photo?.locationLabel || ""),
    exifDate: String(photo?.exifDate || ""),
    metadataEnabled: photo?.metadataEnabled !== false,
    shortQuote: String(photo?.shortQuote || ""),
    cameraModel: String(photo?.cameraModel || ""),
    lens: String(photo?.lens || ""),
    shutter: String(photo?.shutter || ""),
    aperture: String(photo?.aperture || ""),
    iso: String(photo?.iso || ""),
  };
}

function writeAdminPreviewPayload(payload) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(payload || {});
  if (window.sessionStorage) {
    window.sessionStorage.setItem(ADMIN_PREVIEW_STORAGE_KEY, serialized);
  }
  if (window.localStorage) {
    window.localStorage.setItem(ADMIN_PREVIEW_STORAGE_KEY, serialized);
  }
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
        <TextInput label="Title" hint={kind === "photography" ? "Frame title shown in the shoot panel." : "Internal media title or display label."} value={value?.title || ""} onChange={(next) => onChange({ ...value, title: next })} />
        <TextInput label="Caption" hint="Visible caption text used where the page supports it." value={value?.caption || ""} onChange={(next) => onChange({ ...value, caption: next })} />
        {kind === "photography" ? (
          <>
            <TextInput label="Location" hint="Frame-level location override." value={value?.locationLabel || ""} onChange={(next) => onChange({ ...value, locationLabel: next })} />
            <TextInput label="Date" type="date" hint="Captured date for this frame." value={formatDateInput(value?.exifDate)} onChange={(next) => onChange({ ...value, exifDate: toIsoDateTime(next) })} />
            <ToggleField
              label="Metadata enabled"
              hint="Toggle camera/exposure details on the public panel for this frame."
              checked={value?.metadataEnabled !== false}
              onChange={(next) => onChange({ ...value, metadataEnabled: next })}
            />
            <TextInput label="Short quote (bottom)" hint="Displayed in the bottom quote slot for this frame." value={value?.shortQuote || ""} onChange={(next) => onChange({ ...value, shortQuote: next })} />
            <TextInput label="Camera" value={value?.cameraModel || ""} onChange={(next) => onChange({ ...value, cameraModel: next })} />
            <TextInput label="Lens" value={value?.lens || ""} onChange={(next) => onChange({ ...value, lens: next })} />
            <TextInput label="Shutter" placeholder="e.g. 1/250s" value={value?.shutter || ""} onChange={(next) => onChange({ ...value, shutter: next })} />
            <TextInput label="Aperture" placeholder="e.g. f/2.8" value={value?.aperture || ""} onChange={(next) => onChange({ ...value, aperture: next })} />
            <TextInput label="ISO" placeholder="e.g. 400" value={value?.iso || ""} onChange={(next) => onChange({ ...value, iso: next })} />
          </>
        ) : null}
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
          <section className="admin-card-section">
            <div className="admin-section-head">
              <div>
                <h3>Global admin info</h3>
                <p>Reusable profile metadata for public pages (Based / Studying / Shooting / Reading / Email).</p>
              </div>
            </div>
            <div className="admin-grid two-up">
              <TextInput label="Based" value={config.based || ""} onChange={(next) => onChange({ ...config, based: next })} />
              <TextInput label="Studying" value={config.studying || ""} onChange={(next) => onChange({ ...config, studying: next })} />
              <TextInput label="Shooting" value={config.shooting || ""} onChange={(next) => onChange({ ...config, shooting: next })} />
              <TextInput label="Reading" value={config.reading || ""} onChange={(next) => onChange({ ...config, reading: next })} />
              <TextInput label="Email" type="email" value={config.email || ""} onChange={(next) => onChange({ ...config, email: next })} />
            </div>
          </section>
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

function DraftInspectorPanel({ kind, draft, onChange, selectedPhotoIndex, onSelectPhoto }) {
  if (!draft) return null;
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  const clampedIndex = Math.max(0, Math.min(selectedPhotoIndex || 0, Math.max(0, photos.length - 1)));
  const selectedPhoto = photos[clampedIndex] || null;

  function updateSelectedPhoto(updater) {
    if (!selectedPhoto) return;
    const nextPhotos = [...photos];
    nextPhotos[clampedIndex] = updater(selectedPhoto);
    onChange({ ...draft, photos: nextPhotos });
  }

  return (
    <section className="admin-panel admin-aside-panel">
      <div className="admin-panel-head tight">
        <div>
          <h3>Inspector</h3>
          <p>Use this area for working notes and quick metadata edits.</p>
        </div>
      </div>

      {kind === "photography" && selectedPhoto ? (
        <section className="admin-card-section">
          <div className="admin-section-head">
            <div>
              <h3>Photo Inspector</h3>
              <p>Matches the Photo Information model and syncs with Media Library metadata.</p>
            </div>
          </div>
          <label className="admin-field">
            <span className="admin-field-label">Frame</span>
            <select className="admin-select" value={String(clampedIndex)} onChange={(event) => onSelectPhoto(Number(event.target.value) || 0)}>
              {photos.map((_, index) => (
                <option key={`inspector-frame-${index}`} value={String(index)}>
                  Photo {String(index + 1).padStart(2, "0")}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-grid two-up">
            <TextInput label="Title" value={selectedPhoto.title || ""} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, title: next }))} />
            <TextInput label="Caption" value={selectedPhoto.caption || ""} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, caption: next }))} />
            <TextInput label="Location" value={selectedPhoto.locationLabel || ""} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, locationLabel: next }))} />
            <TextInput label="Date" type="date" value={formatDateInput(selectedPhoto.exifDate)} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, exifDate: toIsoDateTime(next) }))} />
            <ToggleField label="Metadata enabled" checked={selectedPhoto.metadataEnabled !== false} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, metadataEnabled: next }))} />
            <TextInput label="Short Quote (for bottom)" value={selectedPhoto.shortQuote || ""} onChange={(next) => updateSelectedPhoto((current) => ({ ...current, shortQuote: next }))} />
          </div>
        </section>
      ) : null}

      <TextArea
        label="Editor Notes"
        hint="Private drafting notes for this item."
        value={draft.adminNotes || ""}
        rows={kind === "photography" ? 8 : 12}
        onChange={(next) => onChange({ ...draft, adminNotes: next })}
      />
    </section>
  );
}

function PhotographyFeaturedManager({ config, options, onChange, onSave, saving }) {
  const items = Array.isArray(config?.items) ? config.items : [];
  const optionMap = new Map(options.map((option) => [`${option.shootId}:${option.photoId}`, option]));
  const firstOption = options[0] || null;

  function upsert(index, key) {
    const selected = optionMap.get(key);
    const nextItems = [...items];
    if (!selected) {
      nextItems.splice(index, 1);
    } else {
      nextItems[index] = selected;
    }
    onChange({ items: nextItems.filter(Boolean) });
  }

  return (
    <section className="admin-panel admin-featured-panel">
      <div className="admin-panel-head">
        <div>
          <h2>Featured photos</h2>
          <p>Choose ordered hero photos for the public photography archive. Only published shoot photos appear here.</p>
        </div>
        <div className="admin-button-row compact">
          <button
            type="button"
            className="admin-mini-button"
            onClick={() => onChange({
              items: [
                ...items,
                firstOption
                  ? { ...firstOption }
                  : {
                    shootId: "",
                    shootSlug: "",
                    shootTitle: "",
                    photoId: "",
                    photoUrl: "",
                    photoAlt: "",
                    locationLabel: "",
                    accentColor: "#c96b28",
                    caption: "",
                  },
              ],
            })}
            disabled={!options.length}
          >
            Add slot
          </button>
          <button type="button" className="admin-primary-button" onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save featured"}
          </button>
        </div>
      </div>
      {!options.length ? <p className="admin-empty-inline">Publish a photography shoot first, then its photos will be available to feature.</p> : null}
      <div className="admin-stack">
        {items.map((item, index) => (
          <article key={`featured-slot-${index}-${item?.shootId || "empty"}-${item?.photoId || "empty"}`} className="admin-subcard">
            <div className="admin-subcard-head">
              <strong>Featured slot {index + 1}</strong>
              <div className="admin-button-row compact">
                <button type="button" className="admin-mini-button" disabled={index === 0} onClick={() => {
                  const next = [...items];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  onChange({ items: next });
                }}>Up</button>
                <button type="button" className="admin-mini-button" disabled={index === items.length - 1} onClick={() => {
                  const next = [...items];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  onChange({ items: next });
                }}>Down</button>
                <button type="button" className="admin-mini-button danger" onClick={() => onChange({ items: items.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            </div>
            <label className="admin-field">
              <span className="admin-field-label">Featured photo</span>
              <select
                className="admin-select"
                value={item ? `${item.shootId}:${item.photoId}` : ""}
                onChange={(event) => upsert(index, event.target.value)}
              >
                <option value="">Select a published photo</option>
                {options.map((option) => (
                  <option key={`${option.shootId}:${option.photoId}`} value={`${option.shootId}:${option.photoId}`}>
                    {option.shootTitle} | {option.locationLabel || option.caption || option.photoId}
                  </option>
                ))}
              </select>
            </label>
            {item?.photoUrl ? (
              <div className="admin-featured-photo-preview">
                <img src={item.photoUrl} alt={item.photoAlt || item.caption || item.shootTitle || "Featured photo"} />
                <div>
                  <strong>{item.shootTitle}</strong>
                  <p>{item.locationLabel || item.caption || "No caption"}</p>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function PhotographyForm({ draft, onChange, onUpload, assets, selectedPhotoIndex, onSelectPhoto }) {
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  const summary = mediaSummaryFromPhotos(photos);
  const themeValue = String(draft.theme || draft.template || PHOTO_TEMPLATES[0]?.value || "desert-bloom");

  function updatePhoto(index, nextPhoto) {
    const next = [...photos];
    next[index] = nextPhoto;
    onChange({ ...draft, photos: next });
  }

  function movePhoto(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= photos.length) return;
    const next = [...photos];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...draft, photos: next });
    if (selectedPhotoIndex === index) {
      onSelectPhoto(target);
    } else if (selectedPhotoIndex === target) {
      onSelectPhoto(index);
    }
  }

  function removePhoto(index) {
    const next = photos.filter((_, itemIndex) => itemIndex !== index);
    onChange({ ...draft, photos: next.length ? next : [createMediaValue()] });
    if (selectedPhotoIndex >= next.length) onSelectPhoto(Math.max(0, next.length - 1));
  }

  return (
    <div className="admin-form-stack">
      <section className="admin-panel">
        <div className="admin-panel-head tight">
          <div>
            <h2>Shoot Information</h2>
            <p>Theme and template are unified. Add one ordered photo sequence for the live page.</p>
          </div>
        </div>
        <div className="admin-grid two-up">
          <TextInput label="Title" value={draft.title} onChange={(next) => onChange({ ...draft, title: next, slug: draft.slug || slugify(next) })} />
          <TextInput label="Location (city, country)" value={draft.locationLabel || ""} onChange={(next) => onChange({ ...draft, locationLabel: next })} />
          <TextInput label="Date" type="date" value={draft.shootDate} onChange={(next) => onChange({ ...draft, shootDate: next })} />
          <TextInput label="Color Picker" type="color" value={draft.accentColor || "#c96b28"} onChange={(next) => onChange({ ...draft, accentColor: next })} />
          <SelectField label="Theme" hint="Template + theme combined into one control." value={themeValue} onChange={(next) => onChange({ ...draft, theme: next, template: next })} options={PHOTO_TEMPLATES} />
          <TextInput label="Tag Word 1" value={draft.tagWord1 || ""} onChange={(next) => onChange({ ...draft, tagWord1: next })} />
          <TextInput label="Tag Word 2" value={draft.tagWord2 || ""} onChange={(next) => onChange({ ...draft, tagWord2: next })} />
          <TextInput label="Tag Word 3" value={draft.tagWord3 || ""} onChange={(next) => onChange({ ...draft, tagWord3: next })} />
        </div>
        <TextArea
          label="Description"
          value={draft.description || draft.notes || ""}
          onChange={(next) => onChange({ ...draft, description: next, notes: next })}
          rows={5}
        />
        <p className="admin-field-hint">Frames attached: {summary.frames} | Detected camera: {summary.cameraModel || "Unknown"}</p>
      </section>

      <section className="admin-card-section">
        <div className="admin-section-head">
          <div>
            <h3>Photo Information</h3>
            <p>Add and order photos. Each photo carries title, caption, location, date, metadata toggle, and quote.</p>
          </div>
          <button type="button" className="admin-mini-button" onClick={() => onChange({ ...draft, photos: [...photos, createMediaValue()] })}>
            Add photo
          </button>
        </div>
        <div className="admin-stack">
          {photos.map((photo, index) => (
            <article className="admin-subcard" key={`photo-slot-${index}`}>
              <div className="admin-subcard-head">
                <strong>Photo {String(index + 1).padStart(2, "0")}</strong>
                <div className="admin-button-row compact">
                  <button type="button" className="admin-mini-button" onClick={() => onSelectPhoto(index)}>Inspect</button>
                  <button type="button" className="admin-mini-button" disabled={index === 0} onClick={() => movePhoto(index, -1)}>Up</button>
                  <button type="button" className="admin-mini-button" disabled={index === photos.length - 1} onClick={() => movePhoto(index, 1)}>Down</button>
                  <button type="button" className="admin-mini-button danger" onClick={() => removePhoto(index)}>Remove</button>
                </div>
              </div>
              <AssetField
                label={`Photo ${index + 1}`}
                accept="image/*"
                value={photo}
                assets={assets}
                onUpload={onUpload}
                onChange={(next) => updatePhoto(index, next)}
                kind="photography"
                field={`photo-${index}`}
                hint="Metadata is auto-extracted when possible and can be overridden here."
              />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function MediaLibrary({ assets, onUpload, onSaveMetadata, onDeleteAsset }) {
  const inputRef = useRef(null);
  const bulkInputRef = useRef(null);
  const [selectedId, setSelectedId] = useState("");
  const [editorState, setEditorState] = useState(createMediaMetadataState(null));
  const [uploading, setUploading] = useState(false);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIndex, setBulkIndex] = useState(0);
  const [bulkItems, setBulkItems] = useState([]);

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

  const activeBulkItem = useMemo(
    () => (bulkOpen && bulkItems.length ? bulkItems[bulkIndex] || null : null),
    [bulkItems, bulkIndex, bulkOpen]
  );

  useEffect(() => {
    setEditorState(createMediaMetadataState(selectedAsset));
  }, [selectedAsset]);

  useEffect(() => {
    if (!bulkOpen || typeof document === "undefined") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [bulkOpen]);

  function closeBulkWizard() {
    setBulkOpen(false);
    setBulkItems([]);
    setBulkIndex(0);
    setBulkSaving(false);
  }

  function updateBulkMetadata(field, value) {
    setBulkItems((current) => current.map((item, index) => (
      index === bulkIndex
        ? { ...item, metadata: { ...item.metadata, [field]: value } }
        : item
    )));
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const asset = await onUpload(file, { kind: "library", field: "library" });
      if (asset?.id) setSelectedId(asset.id);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleBulkFiles(event) {
    const files = Array.from(event.target.files || []).filter((file) => String(file?.type || "").startsWith("image/"));
    event.target.value = "";
    if (!files.length) return;

    setBulkUploading(true);
    const uploaded = [];
    try {
      for (const file of files) {
        try {
          const asset = await onUpload(file, { kind: "library", field: "library" });
          if (asset?.id) uploaded.push(asset);
        } catch {
          // Individual upload notices are already surfaced by onUpload.
        }
      }
    } finally {
      setBulkUploading(false);
    }

    if (!uploaded.length) return;
    setSelectedId(uploaded[uploaded.length - 1].id || "");
    setBulkItems(uploaded.map((asset) => ({
      id: asset.id,
      url: asset.url,
      contentType: asset.contentType,
      fileName: asset.fileName || asset.originalName || "Uploaded image",
      metadata: createMediaMetadataState(asset),
    })));
    setBulkIndex(0);
    setBulkOpen(true);
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

  async function handleSaveBulkAndNext() {
    if (!activeBulkItem) return;
    setBulkSaving(true);
    try {
      const saved = await onSaveMetadata(activeBulkItem.id, activeBulkItem.metadata);
      if (saved?.id) {
        setSelectedId(saved.id);
        setBulkItems((current) => current.map((item, index) => (
          index === bulkIndex
            ? {
                ...item,
                url: saved.url || item.url,
                contentType: saved.contentType || item.contentType,
                fileName: saved.fileName || item.fileName,
                metadata: createMediaMetadataState(saved),
              }
            : item
        )));
      }
      if (bulkIndex >= bulkItems.length - 1) closeBulkWizard();
      else setBulkIndex((current) => current + 1);
    } finally {
      setBulkSaving(false);
    }
  }

  function handleSkipBulk() {
    if (!bulkItems.length) return;
    if (bulkIndex >= bulkItems.length - 1) closeBulkWizard();
    else setBulkIndex((current) => current + 1);
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
        <div className="admin-button-row compact admin-media-upload-actions">
          <button type="button" className="admin-secondary-button" onClick={() => bulkInputRef.current?.click()} disabled={uploading || bulkUploading}>
            {bulkUploading ? "Uploading batch..." : "Bulk Upload"}
          </button>
          <button type="button" className="admin-primary-button" onClick={() => inputRef.current?.click()} disabled={uploading || bulkUploading}>
            {uploading ? "Uploading..." : "Upload media"}
          </button>
        </div>
      </div>

      <input ref={inputRef} type="file" hidden accept="image/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFile} />
      <input ref={bulkInputRef} type="file" hidden multiple accept="image/*" onChange={handleBulkFiles} />

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
                  <TextInput label="Location label" hint="Reusable location metadata for photo lightboxes and captions." value={editorState.locationLabel} onChange={(next) => setEditorState((current) => ({ ...current, locationLabel: next }))} />
                  <TextInput label="Date" type="date" hint="Capture date used for photo metadata displays." value={formatDateInput(editorState.exifDate)} onChange={(next) => setEditorState((current) => ({ ...current, exifDate: toIsoDateTime(next) }))} />
                  <TextInput label="Short quote (bottom)" hint="Optional quote/caption used in photography panel footers." value={editorState.shortQuote} onChange={(next) => setEditorState((current) => ({ ...current, shortQuote: next }))} />
                  <TextInput label="Camera" value={editorState.cameraModel} onChange={(next) => setEditorState((current) => ({ ...current, cameraModel: next }))} />
                  <TextInput label="Lens" value={editorState.lens} onChange={(next) => setEditorState((current) => ({ ...current, lens: next }))} />
                  <TextInput label="Shutter" value={editorState.shutter} onChange={(next) => setEditorState((current) => ({ ...current, shutter: next }))} />
                  <TextInput label="Aperture" value={editorState.aperture} onChange={(next) => setEditorState((current) => ({ ...current, aperture: next }))} />
                  <TextInput label="ISO" value={editorState.iso} onChange={(next) => setEditorState((current) => ({ ...current, iso: next }))} />
                  <ToggleField label="Metadata enabled" checked={editorState.metadataEnabled !== false} onChange={(next) => setEditorState((current) => ({ ...current, metadataEnabled: next }))} />
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

      {bulkOpen && activeBulkItem ? (
        <div className="admin-bulk-overlay" role="dialog" aria-modal="true" aria-label="Bulk photo metadata wizard">
          <section className="admin-bulk-dialog">
            <div className="admin-bulk-head">
              <div>
                <h3>Bulk Photo Metadata</h3>
                <p>Review each uploaded photo and save metadata before moving to the next file.</p>
              </div>
              <div className="admin-bulk-progress">{bulkIndex + 1} / {bulkItems.length}</div>
            </div>

            <div className="admin-bulk-body">
              <div className="admin-bulk-preview">
                {activeBulkItem.contentType?.startsWith("image/") ? (
                  <img src={activeBulkItem.url} alt={activeBulkItem.metadata.alt || activeBulkItem.fileName || "Uploaded image"} />
                ) : (
                  <div className="admin-asset-preview-file">
                    <strong>{activeBulkItem.fileName || "Uploaded file"}</strong>
                    <span>{activeBulkItem.contentType || "File"}</span>
                  </div>
                )}
              </div>

              <div className="admin-bulk-form">
                <div className="admin-grid two-up">
                  <TextInput label="Title" value={activeBulkItem.metadata.title} onChange={(next) => updateBulkMetadata("title", next)} />
                  <TextInput label="Alt" value={activeBulkItem.metadata.alt} onChange={(next) => updateBulkMetadata("alt", next)} />
                  <TextInput label="Caption" value={activeBulkItem.metadata.caption} onChange={(next) => updateBulkMetadata("caption", next)} />
                  <TextInput label="Location" value={activeBulkItem.metadata.locationLabel} onChange={(next) => updateBulkMetadata("locationLabel", next)} />
                  <TextInput label="Date" type="date" value={formatDateInput(activeBulkItem.metadata.exifDate)} onChange={(next) => updateBulkMetadata("exifDate", toIsoDateTime(next))} />
                  <TextInput label="Short quote" value={activeBulkItem.metadata.shortQuote} onChange={(next) => updateBulkMetadata("shortQuote", next)} />
                  <TextInput label="Camera" value={activeBulkItem.metadata.cameraModel} onChange={(next) => updateBulkMetadata("cameraModel", next)} />
                  <TextInput label="Lens" value={activeBulkItem.metadata.lens} onChange={(next) => updateBulkMetadata("lens", next)} />
                  <TextInput label="Shutter" value={activeBulkItem.metadata.shutter} onChange={(next) => updateBulkMetadata("shutter", next)} />
                  <TextInput label="Aperture" value={activeBulkItem.metadata.aperture} onChange={(next) => updateBulkMetadata("aperture", next)} />
                  <TextInput label="ISO" value={activeBulkItem.metadata.iso} onChange={(next) => updateBulkMetadata("iso", next)} />
                  <ToggleField label="Metadata enabled" checked={activeBulkItem.metadata.metadataEnabled !== false} onChange={(next) => updateBulkMetadata("metadataEnabled", next)} />
                </div>
              </div>
            </div>

            <div className="admin-bulk-actions">
              <button type="button" className="admin-secondary-button" onClick={() => setBulkIndex((current) => Math.max(0, current - 1))} disabled={bulkSaving || bulkIndex === 0}>
                Previous
              </button>
              <button type="button" className="admin-secondary-button" onClick={handleSkipBulk} disabled={bulkSaving}>
                Skip
              </button>
              <button type="button" className="admin-primary-button" onClick={handleSaveBulkAndNext} disabled={bulkSaving}>
                {bulkSaving ? "Saving..." : "Save & Next"}
              </button>
              <button type="button" className="admin-secondary-button" onClick={closeBulkWizard} disabled={bulkSaving}>
                Finish
              </button>
            </div>
          </section>
        </div>
      ) : null}
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
          <button type="button" className="admin-primary-button" onClick={() => onCreate("photography")}>New Shoot</button>
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

export default function AdminApp() {
  const [authState, setAuthState] = useState({ loading: true, user: null, claims: {}, isAdmin: false, error: "" });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [lists, setLists] = useState({ faces: [], papers: [], travel: [], photography: [] });
  const [mediaAssets, setMediaAssets] = useState([]);
  const [sectionMediaConfig, setSectionMediaConfig] = useState({
    readStoryPortrait: createMediaValue(),
    papersHeroImage: createMediaValue(),
    papersAuthorPortrait: createMediaValue(),
    based: "",
    studying: "",
    shooting: "",
    reading: "",
    email: "",
  });
  const [photographyFeaturedConfig, setPhotographyFeaturedConfig] = useState({ items: [] });
  const [selectedIds, setSelectedIds] = useState({ faces: "", papers: "", travel: "", photography: "" });
  const [draft, setDraft] = useState(null);
  const [versions, setVersions] = useState([]);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [notice, setNotice] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [working, setWorking] = useState(false);
  const [saveState, setSaveState] = useState("Idle");
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const baselineRef = useRef("");
  const photoMetadataSyncRef = useRef({});
  const isContentSection = activeSection === "faces" || activeSection === "papers" || activeSection === "travel" || activeSection === "photography";
  const activeItems = isContentSection ? (lists[activeSection] || []) : [];
  const draftId = isContentSection ? selectedIds[activeSection] : "";
  const canEdit = authState.isAdmin && isContentSection && draftId;
  const canBuildPreview = canEdit && (activeSection === "faces" || activeSection === "travel" || activeSection === "photography");

  async function syncPhotographyMediaMetadata(sourceDraft, options = {}) {
    if (activeSection !== "photography" || !authState.user || !sourceDraft) {
      return { synced: 0, failed: [] };
    }
    const latestByAsset = new Map();
    (Array.isArray(sourceDraft.photos) ? sourceDraft.photos : []).forEach((photo) => {
      const assetId = String(photo?.assetId || "").trim();
      if (!assetId) return;
      latestByAsset.set(assetId, mediaLibraryMetadataFromPhoto(photo));
    });
    if (!latestByAsset.size) return { synced: 0, failed: [] };

    let synced = 0;
    const failed = [];
    for (const [assetId, updates] of latestByAsset.entries()) {
      const nextHash = JSON.stringify(updates);
      if (photoMetadataSyncRef.current[assetId] === nextHash) continue;
      try {
        await updateMediaAsset(assetId, updates, authState.user);
        photoMetadataSyncRef.current[assetId] = nextHash;
        synced += 1;
      } catch (error) {
        failed.push({ assetId, message: error?.message || "Metadata sync failed." });
      }
    }

    if (failed.length && options.raiseOnFailure) {
      throw new Error(failed[0].message);
    }
    return { synced, failed };
  }

  useEffect(() => {
    let active = true;
    let unsubscribeRef = null;

    async function boot() {
      if (!firebaseReady) {
        setAuthState({ loading: false, user: null, claims: {}, isAdmin: false, error: "Firebase env vars are missing." });
        return;
      }
      try {
        await ensureAdminPersistence();
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
        based: String(config?.based || ""),
        studying: String(config?.studying || ""),
        shooting: String(config?.shooting || ""),
        reading: String(config?.reading || ""),
        email: String(config?.email || ""),
      });
    }, (error) => setNotice({ tone: "error", message: `Site assets failed to load: ${error.message}` }));
    const unsubscribePhotographyFeatured = subscribePhotographyFeaturedConfig((config) => {
      setPhotographyFeaturedConfig({ items: Array.isArray(config?.items) ? config.items : [] });
    }, (error) => setNotice({ tone: "error", message: `Photography featured failed to load: ${error.message}` }));
    unsubscribers.push(unsubscribeMedia, unsubscribeSectionMedia, unsubscribePhotographyFeatured);
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
        if (activeSection === "photography") {
          await syncPhotographyMediaMetadata(draft);
        }
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

  useEffect(() => {
    if (activeSection !== "photography") {
      if (selectedPhotoIndex !== 0) setSelectedPhotoIndex(0);
      return;
    }
    const photos = Array.isArray(draft?.photos) ? draft.photos : [];
    if (!photos.length) {
      if (selectedPhotoIndex !== 0) setSelectedPhotoIndex(0);
      return;
    }
    if (selectedPhotoIndex >= photos.length) {
      setSelectedPhotoIndex(photos.length - 1);
    }
  }, [activeSection, draft, selectedPhotoIndex]);

  const totals = useMemo(() => ({
    faces: lists.faces.length,
    papers: lists.papers.length,
    travel: lists.travel.length,
    photography: lists.photography.length,
  }), [lists]);

  const photographyFeaturedOptions = useMemo(() => {
    const items = [...(lists.photography || [])];
    if (
      activeSection === "photography"
      && draftId
      && draft
      && !items.some((item) => item.id === draftId)
      && (draft.status === "published" || draft.publishedRecord?.slug)
    ) {
      items.unshift({ id: draftId, ...draft });
    }
    return collectFeaturedPhotoOptions(items.filter((item) => item.status === "published" || item.publishedRecord?.slug));
  }, [activeSection, draft, draftId, lists.photography]);

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
      const photoSync = activeSection === "photography" ? await syncPhotographyMediaMetadata(draft) : { failed: [] };
      await saveDraft(activeSection, draftId, draft, authState.user, { captureVersion: true, reason });
      const hydrated = hydrateDraft(activeSection, stampDraftLocally(draft, authState.user));
      setDraft(hydrated);
      baselineRef.current = fingerprint(hydrated);
      setSaveState(`Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      setVersions(await listVersions(activeSection, draftId));
      setNotice({
        tone: photoSync.failed?.length ? "warning" : "success",
        message: photoSync.failed?.length
          ? `Draft saved. ${photoSync.failed.length} linked media item${photoSync.failed.length === 1 ? "" : "s"} could not sync metadata.`
          : "Draft saved.",
      });
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Draft save failed." });
      throw error;
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
      if (asset?.id) {
        photoMetadataSyncRef.current[asset.id] = JSON.stringify(mediaLibraryMetadataFromPhoto(asset));
      }
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
        based: String(saved?.based || ""),
        studying: String(saved?.studying || ""),
        shooting: String(saved?.shooting || ""),
        reading: String(saved?.reading || ""),
        email: String(saved?.email || ""),
      });
      setNotice({ tone: "success", message: "Site assets saved." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Site assets could not be saved." });
    } finally {
      setWorking(false);
    }
  }

  async function handleSavePhotographyFeatured() {
    try {
      setWorking(true);
      const saved = await savePhotographyFeaturedConfig(photographyFeaturedConfig, authState.user);
      setPhotographyFeaturedConfig({ items: Array.isArray(saved?.items) ? saved.items : [] });
      setNotice({ tone: "success", message: "Featured photography updated." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Featured photography could not be saved." });
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

  function handleBuildPreview() {
    if (!canEdit || !draft || typeof window === "undefined") return;
    try {
      if (activeSection === "faces") {
        const preview = faceDraftToPublic(draft, draft.slug || slugify(draft.profileName || draft.title || draft.locationName || draftId));
        const payload = {
          kind: "faces",
          draftId,
          generatedAt: new Date().toISOString(),
          data: {
            id: draftId,
            ...preview,
            lngLat: Array.isArray(preview.lngLat) && preview.lngLat.length === 2 ? preview.lngLat : [0, 0],
          },
        };
        writeAdminPreviewPayload(payload);
        window.open(`${basePath}faces-of-the-world/?adminPreview=1#/profile/${encodeURIComponent(preview.slug)}`, "_blank", "noopener");
      }

      if (activeSection === "travel") {
        const preview = dispatchDraftToPublic(draft, draft.slug || slugify(draft.title || draft.locationName || draftId));
        const post = {
          id: draftId,
          ...preview.post,
        };
        const payload = {
          kind: "travel",
          draftId,
          generatedAt: new Date().toISOString(),
          data: {
            post,
            quotes: Array.isArray(preview.quotes) ? preview.quotes : [],
          },
        };
        writeAdminPreviewPayload(payload);
        window.open(`${basePath}travel-stories?adminPreview=1&post=${encodeURIComponent(post.slug || post.id)}`, "_blank", "noopener");
      }

      if (activeSection === "photography") {
        const preview = photographyDraftToPublic(draft, draft.slug || slugify(draft.title || draft.locationLabel || draftId));
        const payload = {
          kind: "photography",
          draftId,
          generatedAt: new Date().toISOString(),
          data: {
            id: draftId,
            ...preview,
          },
        };
        writeAdminPreviewPayload(payload);
        window.open(`${basePath}photography?adminPreview=1&shoot=${encodeURIComponent(preview.slug)}`, "_blank", "noopener");
      }
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Preview build failed." });
    }
  }

  function renderActiveForm() {
    if (!draft) return <p className="admin-empty-inline">Create or select a draft to start editing.</p>;
    if (activeSection === "faces") return <FacesForm draft={draft} onChange={(next) => setDraft(hydrateDraft("faces", next))} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "papers") return <PapersForm draft={draft} onChange={(next) => setDraft(hydrateDraft("papers", next))} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "travel") return <TravelForm draft={draft} onChange={(next) => setDraft(hydrateDraft("travel", next))} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "photography") {
      return (
        <PhotographyForm
          draft={draft}
          onChange={(next) => setDraft(hydrateDraft("photography", next))}
          onUpload={handleUpload}
          assets={mediaAssets}
          selectedPhotoIndex={selectedPhotoIndex}
          onSelectPhoto={setSelectedPhotoIndex}
        />
      );
    }
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
            {canBuildPreview ? <button type="button" className="admin-secondary-button" onClick={handleBuildPreview} disabled={working || loadingDraft}>Build Preview</button> : null}
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
          <>
            {activeSection === "photography" ? (
              <PhotographyFeaturedManager
                config={photographyFeaturedConfig}
                options={photographyFeaturedOptions}
                onChange={setPhotographyFeaturedConfig}
                onSave={handleSavePhotographyFeatured}
                saving={working}
              />
            ) : null}
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
                {draft ? (
                  <DraftInspectorPanel
                    kind={activeSection}
                    draft={draft}
                    onChange={(next) => setDraft(hydrateDraft(activeSection, next))}
                    selectedPhotoIndex={selectedPhotoIndex}
                    onSelectPhoto={setSelectedPhotoIndex}
                  />
                ) : null}
                <VersionsPanel versions={versions} onRestore={handleRestoreVersion} loading={loadingVersions} />
              </div>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
