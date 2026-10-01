import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../styles/admin.css";
import { firebaseReady } from "../../lib/firebaseClient";
import { completeAdminSignIn, ensureAdminPersistence, getAdminSession, onAdminAuthChange, sendAdminSignInLink, signOutAdmin } from "../../lib/admin/adminAuth";
import { assignAdminClaim, publishDraft, repairCoordinates, rotateWritingShareKey, sendContentBroadcast, unpublishDraft } from "../../lib/admin/functions";
import { dispatchDraftToPublic, faceDraftToPublic, photographyDraftToPublic, slugify } from "../../lib/admin/contentAdapters";
import { collectFeaturedPhotoOptions } from "../../lib/admin/photographyTemplates";
import { createDraft, deleteDraft as deleteDraftRecord, deleteMediaAsset as deleteMediaAssetRecord, getDraft, saveDraft, savePhotographyFeaturedConfig, saveSectionMediaConfig, subscribeAnalytics, subscribeDraftList, subscribeEmailSends, subscribeSystemEmails, subscribeWritingInvites, createWritingInvite, setWritingInviteActive, deleteWritingInvite, formatInviteCode, subscribeMediaAssets, subscribePhotographyFeaturedConfig, subscribeSectionMediaConfig, subscribeSubscribers, updateMediaAsset, uploadMediaAsset } from "../../lib/admin/repository";
import { sendSubscriberSignInLink } from "../../lib/subscriberClient";
import {
  CONTENT_LABELS,
  CONTENT_KINDS,
  createMediaValue,
  hydrateDraft,
  PAPER_TYPES,
} from "../../lib/admin/schemas";
import { validateCoordinates } from "../../lib/admin/coordinates";
import { AssetField, IMAGE_ACCEPT, UploadDropzone, screenFiles } from "./AssetUpload";
import AnalyticsPanel from "./AnalyticsPanel";
import EmailsPanel, { EmailComposerModal } from "./EmailsPanel";
import { DraftNotes, FacesForm, PapersForm, PhotographyForm, StringListEditor, TravelForm } from "./Forms";
import {
  EmptyState,
  MenuItem,
  MoreMenu,
  Notice,
  Section,
  StatTile,
  StatusPill,
  TextArea,
  TextInput,
  ToggleField,
  copyText,
  formatBytes,
  formatDateInput,
  formatNumber,
  formatRelative,
  formatStamp,
  isLive,
  toDate,
  toIsoDateTime,
} from "./ui";

const NAV_GROUPS = [
  { label: "Overview", items: [{ id: "dashboard", label: "Dashboard" }, { id: "analytics", label: "Analytics" }] },
  { label: "Content", items: [
    { id: "faces", label: CONTENT_LABELS.faces },
    { id: "papers", label: CONTENT_LABELS.papers },
    { id: "travel", label: CONTENT_LABELS.travel },
    { id: "photography", label: CONTENT_LABELS.photography },
  ] },
  { label: "Audience", items: [
    { id: "subscribers", label: "Subscribers" },
    { id: "emails", label: "Emails" },
    { id: "invites", label: "Invite Codes" },
  ] },
  { label: "Library", items: [{ id: "media", label: "Media Library" }, { id: "site-assets", label: "Site Settings" }] },
];

const SECTION_TITLES = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  subscribers: "Subscribers",
  emails: "Emails",
  invites: "Invite Codes",
  media: "Media Library",
  "site-assets": "Site Settings",
  ...CONTENT_LABELS,
};

const NEW_LABELS = { faces: "New profile", papers: "New paper", travel: "New dispatch", photography: "New shoot" };
const KIND_ITEM_NOUN = { faces: "profile", papers: "paper", travel: "dispatch", photography: "shoot" };

const ADMIN_PREVIEW_STORAGE_KEY = "sfa-admin-preview-v1";
const SUBSCRIBER_SEGMENTS = ["Articles & Op-Eds", "Photography", "Faces of the World", "Travel"];
const base = import.meta.env.BASE_URL ?? "/";
const basePath = base.endsWith("/") ? base : `${base}/`;

function itemTitle(item) {
  return item?.title || item?.profileName || item?.locationName || "Untitled";
}

function liveUrl(kind, draft) {
  const slug = encodeURIComponent(draft?.publishedRecord?.slug || draft?.slug || "");
  if (!slug || typeof window === "undefined") return "";
  const origin = window.location.origin + basePath;
  if (kind === "papers") {
    if (draft.audience && draft.audience !== "public") return "";
    return `${origin}selected-papers/?paper=${slug}`;
  }
  if (kind === "travel") return `${origin}travel-stories/?post=${slug}`;
  if (kind === "photography") return `${origin}photography/?shoot=${slug}`;
  if (kind === "faces") return `${origin}faces-of-the-world/#/profile/${slug}`;
  return "";
}

function normalizeSubscriberSegments(subscriber) {
  const direct = Array.isArray(subscriber?.segmentTags)
    ? subscriber.segmentTags.filter((item) => SUBSCRIBER_SEGMENTS.includes(item))
    : [];
  if (direct.length) return Array.from(new Set(direct));

  const preferences = Array.isArray(subscriber?.preferences) ? subscriber.preferences : [];
  if (preferences.includes("all")) return [...SUBSCRIBER_SEGMENTS];

  const tags = [];
  if (preferences.includes("articles") || preferences.includes("papers") || subscriber?.wantsPapers) tags.push("Articles & Op-Eds");
  if (preferences.includes("photography") || subscriber?.wantsPhotography) tags.push("Photography");
  if (preferences.includes("faces") || preferences.includes("stories") || subscriber?.wantsFaces) tags.push("Faces of the World");
  if (preferences.includes("travel") || subscriber?.wantsTravel) tags.push("Travel");
  if (subscriber?.wantsAllUpdates) return [...SUBSCRIBER_SEGMENTS];
  return Array.from(new Set(tags));
}

function formatSubscriberSource(value) {
  return String(value || "unknown").replace(/_/g, " ");
}

function isSubscriberVerified(subscriber) {
  return subscriber?.verified === true && (subscriber?.status || "active") === "active";
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

function SiteAssetsForm({ config, assets, onUpload, onChange, onSave, onRepairCoordinates, saving }) {
  const authorPortrait = config.papersAuthorPortrait || createMediaValue();
  const papersTypewriterLinesValue = Array.isArray(config.papersTypewriterLines) ? config.papersTypewriterLines.join("\n") : "";
  const papersWritingTypes = Array.isArray(config.papersWritingTypes) ? config.papersWritingTypes : [];
  return (
    <section className="admin-editor-grid single-panel">
      <section className="admin-panel admin-editor-panel">
        <div className="admin-panel-head">
          <div>
            <h2>Site settings</h2>
            <p>Portraits, hero art and the short profile details shown across the public pages.</p>
          </div>
          <div className="admin-button-row compact">
            <button type="button" className="admin-secondary-button" onClick={onRepairCoordinates} disabled={saving}>
              Repair map pins
            </button>
            <button type="button" className="admin-primary-button" onClick={onSave} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
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
          <section className="admin-card-section">
            <div className="admin-section-head">
              <div>
                <h3>Selected Papers rotating lines</h3>
                <p>One line per row. These lines power the typewriter text in the Papers hero.</p>
              </div>
            </div>
            <TextArea
              label="Hero typewriter lines"
              rows={6}
              value={papersTypewriterLinesValue}
              placeholder={"Line one\nLine two\nLine three"}
              onChange={(next) => onChange({
                ...config,
                papersTypewriterLines: String(next || "")
                  .split(/\r?\n/)
                  .filter((line, index, lines) => line.length > 0 || (index < lines.length - 1)),
              })}
            />
          </section>
          <StringListEditor
            label="Selected Papers writing types"
            values={papersWritingTypes}
            onChange={(next) => onChange({ ...config, papersWritingTypes: next })}
            addLabel="Add writing type"
          />
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

function MediaLibrary({ assets, onUpload, onSaveMetadata, onDeleteAsset }) {
  const [selectedId, setSelectedId] = useState("");
  const [uploadErrors, setUploadErrors] = useState([]);
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

  async function handleDropped(fileList) {
    const { ok, errors } = screenFiles(fileList, `${IMAGE_ACCEPT},.pdf,.doc,.docx`);
    setUploadErrors(errors);
    if (!ok.length) return;
    if (ok.length === 1 || !ok.every((file) => String(file.type || "").startsWith("image/"))) {
      setUploading(true);
      try {
        for (const file of ok) {
          try {
            const asset = await onUpload(file, { kind: "library", field: "library" });
            if (asset?.id) setSelectedId(asset.id);
          } catch {
            // The upload notice is already surfaced by onUpload.
          }
        }
      } finally {
        setUploading(false);
      }
      return;
    }
    await handleBulkFiles(ok);
  }

  async function handleBulkFiles(files) {
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
    <section className="admin-panel media-panel-full admin-form-stack">
      <div className="admin-panel-head">
        <div>
          <h2>Media Library</h2>
          <p>Everything you have uploaded. Edit captions and alt text here, then reuse a file anywhere on the site.</p>
        </div>
      </div>

      <UploadDropzone
        multiple
        accept={`${IMAGE_ACCEPT},.pdf,.doc,.docx`}
        busy={uploading || bulkUploading}
        onFiles={handleDropped}
        title={uploading || bulkUploading ? "Uploading..." : "Drop files here or click to upload"}
        subtitle="Images, PDFs and Word documents. Drop several photos to add details to each in one pass."
      />
      {uploadErrors.map((message) => <p className="admin-inline-error" key={message}>{message}</p>)}

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
                </div>

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

export function Dashboard({ lists, analytics, subscribers, emailSends, systemEmails, onCreate, onJump, onNavigate }) {
  const stats = useMemo(() => {
    const all = CONTENT_KINDS.flatMap((kind) => (lists[kind] || []).map((item) => ({ kind, ...item })));
    const sevenDays = new Set();
    for (let offset = 0; offset < 7; offset += 1) {
      sevenDays.add(new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10));
    }
    const week = analytics.filter((doc) => sevenDays.has(doc.id));
    const verified = subscribers.filter(isSubscriberVerified);
    const weekAgo = Date.now() - 7 * 86400000;
    const realSends = emailSends.filter((send) => !send.test);
    return {
      live: all.filter(isLive).length,
      notLive: all.filter((item) => !isLive(item)).length,
      views: week.reduce((sum, doc) => sum + Number(doc.views || 0), 0),
      visitors: week.reduce((sum, doc) => sum + Number(doc.uniques || 0), 0),
      subscribers: verified.length,
      newSubscribers: verified.filter((subscriber) => (toDate(subscriber.createdAt)?.getTime() || 0) >= weekAgo).length,
      pendingVerification: subscribers.length - verified.length,
      lastSend: realSends[0] || null,
      failedSends: realSends.filter((send) => send.status === "failed" || send.status === "partial").length,
      failedSystem: systemEmails.filter((item) => item.status !== "sent").length,
      recent: [...all].sort((left, right) => (toDate(right.updatedAt)?.getTime() || 0) - (toDate(left.updatedAt)?.getTime() || 0)).slice(0, 6),
    };
  }, [lists, analytics, subscribers, emailSends, systemEmails]);

  const attention = [];
  if (stats.failedSends) attention.push({ key: "sends", tone: "bad", text: `${stats.failedSends} email${stats.failedSends === 1 ? "" : "s"} had delivery problems.`, action: "Review", go: "emails" });
  if (stats.failedSystem) attention.push({ key: "system", tone: "bad", text: `${stats.failedSystem} sign-in email${stats.failedSystem === 1 ? "" : "s"} failed to send.`, action: "Review", go: "emails" });
  if (stats.pendingVerification) attention.push({ key: "verify", tone: "warn", text: `${stats.pendingVerification} subscriber${stats.pendingVerification === 1 ? " has" : "s have"} not verified yet.`, action: "View", go: "subscribers" });
  if (stats.notLive) attention.push({ key: "notlive", tone: "muted", text: `${stats.notLive} item${stats.notLive === 1 ? " is" : "s are"} saved but not live on the site.`, action: "", go: "" });

  return (
    <div className="admin-dashboard">
      <div className="admin-stat-grid">
        <StatTile value={formatNumber(stats.views)} label="Page views, last 7 days" hint={`${formatNumber(stats.visitors)} visitors`} />
        <StatTile value={formatNumber(stats.subscribers)} label="Verified subscribers" hint={`+${stats.newSubscribers} this week`} />
        <StatTile value={formatNumber(stats.live)} label="Live on the site" hint={`${stats.notLive} not live`} />
        <StatTile value={stats.lastSend ? <StatusPill status={stats.lastSend.status || "sent"} /> : "—"} label="Latest email" hint={stats.lastSend ? `${stats.lastSend.subject} · ${formatRelative(stats.lastSend.sentAt) || "just now"}` : "Nothing sent yet"} />
      </div>

      <div className="admin-two-col">
        <Section title="Start something new" description="Create an item, then publish it when it is ready.">
          <div className="admin-button-grid">
            {CONTENT_KINDS.map((kind) => (
              <button key={kind} type="button" className="admin-quick-action" onClick={() => onCreate(kind)}>
                <strong>{NEW_LABELS[kind]}</strong>
                <small>{CONTENT_LABELS[kind]}</small>
              </button>
            ))}
            <button type="button" className="admin-quick-action" onClick={() => onNavigate("emails")}>
              <strong>Email subscribers</strong>
              <small>Compose an announcement</small>
            </button>
          </div>
        </Section>

        <Section title="Needs attention">
          {attention.length ? (
            <ul className="admin-attention-list">
              {attention.map((item) => (
                <li key={item.key} className={`tone-${item.tone}`}>
                  <span>{item.text}</span>
                  {item.go ? <button type="button" className="admin-mini-button" onClick={() => onNavigate(item.go)}>{item.action}</button> : null}
                </li>
              ))}
            </ul>
          ) : <p className="admin-empty-inline">Everything looks good.</p>}
        </Section>
      </div>

      <Section title="Pick up where you left off">
        <div className="admin-recent-list">
          {stats.recent.length ? stats.recent.map((item) => (
            <button key={`${item.kind}-${item.id}`} type="button" className="admin-recent-row" onClick={() => onJump(item.kind, item.id)}>
              <div>
                <strong>{itemTitle(item)}</strong>
                <p>{CONTENT_LABELS[item.kind]} &middot; edited {formatRelative(item.updatedAt) || "just now"}</p>
              </div>
              <StatusPill status={isLive(item) ? "published" : "draft"} />
            </button>
          )) : <EmptyState title="Nothing here yet">Create your first item above.</EmptyState>}
        </div>
      </Section>
    </div>
  );
}

export function CollectionList({ kind, items, selectedId, onSelect, onCreate, creating }) {
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState("all");
  const visible = items.filter((item) => {
    if (filter === "live" && !isLive(item)) return false;
    if (filter === "notlive" && isLive(item)) return false;
    const needle = queryText.trim().toLowerCase();
    return !needle || itemTitle(item).toLowerCase().includes(needle);
  });
  return (
    <aside className="admin-list-panel">
      <div className="admin-list-head">
        <div>
          <h2>{CONTENT_LABELS[kind]}</h2>
          <p>{items.length} item{items.length === 1 ? "" : "s"}</p>
        </div>
        <button type="button" className="admin-primary-button small" onClick={() => onCreate(kind)} disabled={creating}>{NEW_LABELS[kind]}</button>
      </div>
      {items.length > 4 ? (
        <div className="admin-list-tools">
          <input className="admin-input" type="search" placeholder="Search" value={queryText} onChange={(event) => setQueryText(event.target.value)} />
          <div className="admin-segmented small">
            {[["all", "All"], ["live", "Live"], ["notlive", "Not live"]].map(([id, label]) => (
              <button key={id} type="button" className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="admin-list-scroll">
        {visible.length ? visible.map((item) => (
          <button type="button" key={item.id} className={`admin-list-item${selectedId === item.id ? " is-active" : ""}`} onClick={() => onSelect(item.id)}>
            <div>
              <strong>{itemTitle(item)}</strong>
              <p>{formatRelative(item.updatedAt) || "new"}</p>
            </div>
            <StatusPill status={isLive(item) ? "published" : "draft"} />
          </button>
        )) : <p className="admin-empty-inline">{items.length ? "Nothing matches." : `No ${KIND_ITEM_NOUN[kind]}s yet.`}</p>}
      </div>
    </aside>
  );
}

export function SubscribersPanel({ subscribers, onPromptVerify, promptingId }) {
  const [queryText, setQueryText] = useState("");
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const verified = subscribers.filter(isSubscriberVerified);
    const unverified = subscribers.filter((subscriber) => !isSubscriberVerified(subscriber));
    const withName = verified.filter((subscriber) => String(subscriber.name || "").trim()).length;
    const segmentCounts = SUBSCRIBER_SEGMENTS.map((segment) => ({
      segment,
      count: verified.filter((subscriber) => normalizeSubscriberSegments(subscriber).includes(segment)).length,
    }));
    const recent = verified.filter((subscriber) => {
      const created = toDate(subscriber.createdAt);
      return created && now - created.getTime() <= 30 * dayMs;
    }).length;
    const week = verified.filter((subscriber) => {
      const created = toDate(subscriber.createdAt);
      return created && now - created.getTime() <= 7 * dayMs;
    }).length;
    const newest = [...verified].sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0))[0];
    return {
      total: verified.length,
      unverified: unverified.length,
      recent,
      week,
      withName,
      newestAt: newest?.createdAt,
      segmentCounts,
    };
  }, [subscribers]);

  const groupedSubscribers = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    const sorted = [...subscribers].sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0));
    const filtered = !needle ? sorted : sorted.filter((subscriber) => {
      const haystack = [
        subscriber.email,
        subscriber.emailLower,
        subscriber.name,
        subscriber.source,
        subscriber.status,
        isSubscriberVerified(subscriber) ? "verified" : "unverified pending",
        ...normalizeSubscriberSegments(subscriber),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
    return {
      verified: filtered.filter(isSubscriberVerified),
      unverified: filtered.filter((subscriber) => !isSubscriberVerified(subscriber)),
      total: filtered.length,
    };
  }, [queryText, subscribers]);

  return (
    <section className="admin-subscriber-layout">
      <div className="admin-panel full-span">
        <div className="admin-panel-head">
          <div>
            <h2>Subscriber Overview</h2>
            <p>People who have confirmed through the Firebase email-link subscription flow.</p>
          </div>
        </div>
        <div className="admin-stat-grid">
	          <article className="admin-stat-card"><strong>{stats.total}</strong><span>Verified subscribers</span></article>
	          <article className="admin-stat-card"><strong>{stats.unverified}</strong><span>Not verified</span></article>
	          <article className="admin-stat-card"><strong>{stats.week}</strong><span>New in 7 days</span></article>
	          <article className="admin-stat-card"><strong>{stats.recent}</strong><span>New in 30 days</span></article>
	        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-head tight">
          <div>
            <h2>Segment Trends</h2>
            <p>Current list size by newsletter segment.</p>
          </div>
        </div>
        <div className="admin-segment-list">
          {stats.segmentCounts.map((item) => (
            <div className="admin-segment-row" key={item.segment}>
              <span>{item.segment}</span>
              <strong>{item.count}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-panel-head tight">
          <div>
            <h2>Recent Pulse</h2>
            <p>Quick health checks for the list.</p>
          </div>
        </div>
        <div className="admin-meta-list">
          <div>
            <dt>Newest signup</dt>
            <dd>{stats.newestAt ? formatStamp(stats.newestAt) : "No subscribers yet"}</dd>
          </div>
	          <div>
	            <dt>Completion rate</dt>
	            <dd>{stats.total ? `${Math.round((stats.withName / stats.total) * 100)}% include a name` : "No active subscribers yet"}</dd>
	          </div>
	          <div>
	            <dt>Verification queue</dt>
	            <dd>{stats.unverified ? `${stats.unverified} pending verification` : "No pending verifications"}</dd>
	          </div>
	        </div>
      </div>

      <div className="admin-panel full-span">
        <div className="admin-panel-head">
	          <div>
	            <h2>All Subscribers</h2>
	            <p>{groupedSubscribers.total} shown of {subscribers.length} total records, grouped by verification.</p>
	          </div>
          <input className="admin-input admin-subscriber-search" type="search" value={queryText} placeholder="Search subscribers" onChange={(event) => setQueryText(event.target.value)} />
        </div>
        <div className="admin-subscriber-table-wrap">
          <table className="admin-subscriber-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Segments</th>
                <th>Source</th>
	                <th>Joined</th>
	                <th>Verification</th>
	                <th>Actions</th>
	              </tr>
	            </thead>
	            <tbody>
	              {[
	                { key: "unverified", label: "Not verified", items: groupedSubscribers.unverified },
	                { key: "verified", label: "Verified", items: groupedSubscribers.verified },
	              ].map((group) => (
	                group.items.length ? (
	                  <Fragment key={group.key}>
	                    <tr className="admin-subscriber-group-row" key={`${group.key}-heading`}>
	                      <td colSpan={7}>{group.label} ({group.items.length})</td>
	                    </tr>
	                    {group.items.map((subscriber) => {
	                      const segments = normalizeSubscriberSegments(subscriber);
	                      const email = subscriber.email || subscriber.emailLower || "";
	                      const verified = isSubscriberVerified(subscriber);
	                      const rowActionKey = subscriber.id || email;
	                      return (
	                        <tr key={subscriber.id}>
	                          <td>{email || "Unknown"}</td>
	                          <td>{subscriber.name || "Optional"}</td>
	                          <td>
	                            <div className="admin-tag-row">
	                              {segments.length ? segments.map((segment) => <span className="admin-chip" key={segment}>{segment}</span>) : <span className="admin-chip muted">Unsegmented</span>}
	                            </div>
	                          </td>
	                          <td>{formatSubscriberSource(subscriber.source)}</td>
	                          <td>{formatStamp(subscriber.createdAt, { dateOnly: true, empty: "Unknown" })}</td>
	                          <td><StatusPill status={verified ? "verified" : "not verified"} /></td>
	                          <td>
	                            {!verified ? (
	                              <button
	                                type="button"
	                                className="admin-mini-button"
	                                disabled={!email || promptingId === rowActionKey}
	                                onClick={() => onPromptVerify(subscriber)}
	                              >
	                                {promptingId === rowActionKey ? "Sending..." : "Prompt verify"}
	                              </button>
	                            ) : <span className="admin-empty-inline">Verified</span>}
	                          </td>
	                        </tr>
	                      );
	                    })}
	                  </Fragment>
	                ) : null
	              ))}
	            </tbody>
	          </table>
	          {!groupedSubscribers.total ? <p className="admin-empty-inline">No subscribers match that search.</p> : null}
	        </div>
      </div>
    </section>
  );
}

function InviteCodesPanel({ invites, onCreate, onToggle, onDelete }) {
  const [label, setLabel] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [scopes, setScopes] = useState({ drafts: true, unpublished: true });
  const [copiedId, setCopiedId] = useState("");
  const chosen = Object.keys(scopes).filter((key) => scopes[key]);
  async function submit(event) {
    event.preventDefault();
    if (!chosen.length) return;
    const ok = await onCreate({ label, collections: chosen, customCode, expiresAt: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : "" });
    if (ok) { setLabel(""); setCustomCode(""); setExpiresAt(""); }
  }
  const scopeLabel = { drafts: "Drafts", unpublished: "Unpublished Thoughts" };
  return (
    <section className="admin-subscriber-layout">
      <div className="admin-panel full-span">
        <div className="admin-panel-head tight">
          <div>
            <h2>New invite code</h2>
            <p>Visitors who click Drafts or Unpublished Thoughts on Selected Writing must enter a code. Leave the code blank to generate one.</p>
          </div>
        </div>
        <form className="admin-form-stack" onSubmit={submit}>
          <div className="admin-grid two-up">
            <TextInput label="Who is it for? (just a note to yourself)" value={label} onChange={setLabel} placeholder="e.g. Professor Lin" />
            <TextInput label="Custom code (optional)" value={customCode} onChange={setCustomCode} placeholder="Letters and numbers, 6+ characters" />
            <TextInput label="Expires (optional)" type="date" value={expiresAt} onChange={setExpiresAt} />
          </div>
          <div className="admin-grid two-up toggles">
            <ToggleField label="Can open Drafts" checked={scopes.drafts} onChange={(next) => setScopes({ ...scopes, drafts: next })} />
            <ToggleField label="Can open Unpublished Thoughts" checked={scopes.unpublished} onChange={(next) => setScopes({ ...scopes, unpublished: next })} />
          </div>
          <div><button type="submit" className="admin-primary-button" disabled={!chosen.length}>Create invite code</button></div>
        </form>
      </div>
      <div className="admin-panel full-span">
        <div className="admin-panel-head tight"><div><h2>Codes</h2><p>Turn a code off to revoke it without deleting its history.</p></div></div>
        <div className="admin-subscriber-table-wrap">
          <table className="admin-subscriber-table">
            <thead><tr><th>Code</th><th>For</th><th>Access</th><th>Uses</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td><code>{formatInviteCode(invite.id)}</code></td>
                  <td>{invite.label || "-"}</td>
                  <td>{(invite.collections || []).map((key) => scopeLabel[key] || key).join(", ")}</td>
                  <td>{invite.uses || 0}</td>
                  <td>{invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : "Never"}</td>
                  <td>{invite.active === false ? "Off" : "On"}</td>
                  <td>
                    <div className="admin-inline-actions">
                      <button type="button" className="admin-mini-button" onClick={() => copyText(formatInviteCode(invite.id)).then(() => { setCopiedId(invite.id); setTimeout(() => setCopiedId(""), 1500); })}>{copiedId === invite.id ? "Copied" : "Copy"}</button>
                      <button type="button" className="admin-mini-button" onClick={() => onToggle(invite)}>{invite.active === false ? "Turn on" : "Turn off"}</button>
                      <button type="button" className="admin-mini-button danger" onClick={() => onDelete(invite)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!invites.length ? <p className="admin-empty-inline">No invite codes yet.</p> : null}
        </div>
      </div>
    </section>
  );
}

const VALID_SECTIONS = new Set(["dashboard", "analytics", "subscribers", "emails", "invites", "media", "site-assets", ...CONTENT_KINDS]);

function sectionFromHash() {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace(/^#/, "");
  return VALID_SECTIONS.has(hash) ? hash : "dashboard";
}

export default function AdminApp() {
  const [authState, setAuthState] = useState({ loading: true, user: null, claims: {}, isAdmin: false, error: "" });
  const [activeSection, setActiveSection] = useState("dashboard");
  const [lists, setLists] = useState({ faces: [], papers: [], travel: [], photography: [] });
  const [mediaAssets, setMediaAssets] = useState([]);
  const [subscribers, setSubscribers] = useState([]);
  const [emailSends, setEmailSends] = useState([]);
  const [systemEmails, setSystemEmails] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [invites, setInvites] = useState([]);
  const [emailComposer, setEmailComposer] = useState(null);
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [sectionMediaConfig, setSectionMediaConfig] = useState({
    readStoryPortrait: createMediaValue(),
    papersHeroImage: createMediaValue(),
    papersAuthorPortrait: createMediaValue(),
    papersTypewriterLines: [],
    papersWritingTypes: [],
    based: "",
    studying: "",
    shooting: "",
    reading: "",
    email: "",
  });
  const [photographyFeaturedConfig, setPhotographyFeaturedConfig] = useState({ items: [] });
  const [selectedIds, setSelectedIds] = useState({ faces: "", papers: "", travel: "", photography: "" });
  const [draft, setDraft] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [notice, setNotice] = useState(null);
  const [emailInput, setEmailInput] = useState("");
  const [working, setWorking] = useState(false);
  const [promptingSubscriberId, setPromptingSubscriberId] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const baselineRef = useRef("");
  const draftRef = useRef(null);
  const photoMetadataSyncRef = useRef({});
  const isContentSection = CONTENT_KINDS.includes(activeSection);
  const activeItems = isContentSection ? (lists[activeSection] || []) : [];
  const draftId = isContentSection ? selectedIds[activeSection] : "";
  const canEdit = authState.isAdmin && isContentSection && draftId;
  const canBuildPreview = canEdit && (activeSection === "faces" || activeSection === "travel" || activeSection === "photography");
  const draftIsLive = isLive(draft);
  const dismissNotice = useCallback(() => setNotice(null), []);

  draftRef.current = draft;

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

  // Saves the open item right now. Returns the saved (hydrated) draft.
  async function saveNow() {
    const current = draftRef.current;
    if (!canEdit || !current) return null;
    setSaveState("saving");
    try {
      const photoSync = activeSection === "photography" ? await syncPhotographyMediaMetadata(current) : { failed: [] };
      await saveDraft(activeSection, draftId, current, authState.user);
      baselineRef.current = fingerprint(current);
      setSaveState("saved");
      if (photoSync.failed?.length) {
        setNotice({ tone: "warning", message: `Saved. ${photoSync.failed.length} photo detail${photoSync.failed.length === 1 ? "" : "s"} could not sync to the Media Library.` });
      }
      return current;
    } catch (error) {
      setSaveState("error");
      setNotice({ tone: "error", message: error.message || "Save failed." });
      throw error;
    }
  }

  async function reloadDraft() {
    const loaded = await getDraft(activeSection, draftId);
    const hydrated = hydrateDraft(activeSection, loaded || {});
    setDraft(hydrated);
    baselineRef.current = fingerprint(hydrated);
    setSaveState("saved");
    return hydrated;
  }

  // Section is remembered in the URL hash so refresh and the back button keep your place.
  useEffect(() => {
    setActiveSection(sectionFromHash());
    const onHash = () => setActiveSection(sectionFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(section) {
    setActiveSection(section);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${section}`);
    window.scrollTo?.({ top: 0 });
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
          const session = await getAdminSession(user, true);
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

  // Keep the admin's own visits out of the public analytics.
  useEffect(() => {
    if (!authState.isAdmin) return;
    try {
      window.localStorage.setItem("sfa-no-track", "1");
    } catch {
      // Storage can be unavailable in private windows; analytics just counts this browser.
    }
  }, [authState.isAdmin]);

  useEffect(() => {
    if (!authState.isAdmin) return undefined;
    const unsubscribers = CONTENT_KINDS.map((kind) => subscribeDraftList(kind, (items) => {
      setLists((current) => ({ ...current, [kind]: items }));
    }, (error) => setNotice({ tone: "error", message: `${CONTENT_LABELS[kind]} failed to load: ${error.message}` })));
    const unsubscribeMedia = subscribeMediaAssets(setMediaAssets, (error) => setNotice({ tone: "error", message: `Media library failed to load: ${error.message}` }));
    const unsubscribeSubscribers = subscribeSubscribers(setSubscribers, async (error) => {
      const code = String(error?.code || "");
      if (code.includes("permission-denied")) {
        try {
          await refreshSession(true);
          setNotice({ tone: "warning", message: "Refreshing admin session for subscribers..." });
          return;
        } catch {
          // fall through to explicit error notice below
        }
      }
      setNotice({ tone: "error", message: `Subscribers failed to load: ${error.message}` });
    });
    const unsubscribeSectionMedia = subscribeSectionMediaConfig((config) => {
      setSectionMediaConfig({
        readStoryPortrait: config?.readStoryPortrait || createMediaValue(),
        papersHeroImage: config?.papersHeroImage || createMediaValue(),
        papersAuthorPortrait: config?.papersAuthorPortrait || createMediaValue(),
        papersTypewriterLines: Array.isArray(config?.papersTypewriterLines) ? config.papersTypewriterLines.filter((line) => String(line || "").trim()) : [],
        papersWritingTypes: Array.isArray(config?.papersWritingTypes) ? config.papersWritingTypes.filter((type) => String(type || "").trim()) : [],
        based: String(config?.based || ""),
        studying: String(config?.studying || ""),
        shooting: String(config?.shooting || ""),
        reading: String(config?.reading || ""),
        email: String(config?.email || ""),
      });
    }, (error) => setNotice({ tone: "error", message: `Site settings failed to load: ${error.message}` }));
    const unsubscribePhotographyFeatured = subscribePhotographyFeaturedConfig((config) => {
      setPhotographyFeaturedConfig({ items: Array.isArray(config?.items) ? config.items : [] });
    }, (error) => setNotice({ tone: "error", message: `Photography featured failed to load: ${error.message}` }));
    const unsubscribeEmailSends = subscribeEmailSends(setEmailSends, (error) => setNotice({ tone: "error", message: `Email history failed to load: ${error.message}` }));
    const unsubscribeSystemEmails = subscribeSystemEmails(setSystemEmails, () => setSystemEmails([]));
    const unsubscribeAnalytics = subscribeAnalytics(190, setAnalytics, () => setAnalytics([]));
    const unsubscribeInvites = subscribeWritingInvites(setInvites, (error) => setNotice({ tone: "error", message: `Invite codes failed to load: ${error.message}` }));
    unsubscribers.push(unsubscribeInvites, unsubscribeMedia, unsubscribeSubscribers, unsubscribeSectionMedia, unsubscribePhotographyFeatured, unsubscribeEmailSends, unsubscribeSystemEmails, unsubscribeAnalytics);
    return () => unsubscribers.forEach((unsubscribe) => typeof unsubscribe === "function" && unsubscribe());
  }, [authState.isAdmin, authState.user?.uid, authState.claims?.iat]);

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
    if (!isContentSection || !draftId) {
      setDraft(null);
      baselineRef.current = "";
      return undefined;
    }
    let active = true;
    setLoadingDraft(true);
    getDraft(activeSection, draftId)
      .then((loaded) => {
        if (!active) return;
        const hydrated = hydrateDraft(activeSection, loaded || {});
        setDraft(hydrated);
        baselineRef.current = fingerprint(hydrated);
        setSaveState("saved");
      })
      .catch((error) => {
        if (active) setNotice({ tone: "error", message: error.message || "Item could not be loaded." });
      })
      .finally(() => {
        if (active) setLoadingDraft(false);
      });
    return () => {
      active = false;
    };
  }, [activeSection, draftId, isContentSection]);

  // Autosave: every edit is saved a moment after you stop typing.
  useEffect(() => {
    if (!canEdit || !draft || typeof window === "undefined") return undefined;
    const currentFingerprint = fingerprint(draft);
    if (!baselineRef.current || currentFingerprint === baselineRef.current) return undefined;
    setSaveState("dirty");
    const timeout = window.setTimeout(() => {
      saveNow().catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [draft, canEdit, activeSection, draftId, authState.user]);

  // Warn before closing the tab while an edit has not been written yet.
  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (saveState === "dirty" || saveState === "saving") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  // Ctrl/Cmd+S saves immediately.
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canEdit && draftRef.current) saveNow().catch(() => undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  const paperTypeOptions = useMemo(() => {
    const custom = Array.isArray(sectionMediaConfig?.papersWritingTypes)
      ? sectionMediaConfig.papersWritingTypes.map((type) => String(type || "").trim()).filter(Boolean)
      : [];
    const merged = custom.length ? custom : PAPER_TYPES;
    return Array.from(new Set(merged));
  }, [sectionMediaConfig]);

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

  async function handlePromptSubscriberVerify(subscriber) {
    const email = String(subscriber?.email || subscriber?.emailLower || "").trim();
    if (!email) {
      setNotice({ tone: "error", message: "This subscriber does not have an email address to prompt." });
      return;
    }
    const confirmed = window.confirm(`Send a verification prompt to ${email}?`);
    if (!confirmed) return;

    try {
      setPromptingSubscriberId(subscriber.id || email);
      const redirectUrl = typeof window !== "undefined"
        ? `${window.location.origin}${basePath}selected-papers/`
        : "";
      const result = await sendSubscriberSignInLink({
        email,
        name: subscriber.name || "",
        preferences: Array.isArray(subscriber.preferences) ? subscriber.preferences : [],
        segmentTags: normalizeSubscriberSegments(subscriber),
        source: subscriber.source || "admin_verify_prompt",
        redirectUrl,
      });
      if (!result.ok) {
        throw new Error("Could not send verification prompt.");
      }
      setNotice({ tone: "success", message: `Verification prompt sent to ${email}.` });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Could not send verification prompt." });
    } finally {
      setPromptingSubscriberId("");
    }
  }

  async function handleCreateInvite(input) {
    try {
      const code = await createWritingInvite(input, authState.user);
      setNotice({ tone: "success", message: `Invite code ${formatInviteCode(code)} created.` });
      return true;
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Invite code could not be created." });
      return false;
    }
  }

  async function handleToggleInvite(invite) {
    try {
      await setWritingInviteActive(invite.id, invite.active === false);
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Invite code could not be updated." });
    }
  }

  async function handleDeleteInvite(invite) {
    if (typeof window !== "undefined" && !window.confirm(`Delete invite code ${formatInviteCode(invite.id)}? Anyone using it will lose access.`)) return;
    try {
      await deleteWritingInvite(invite.id);
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Invite code could not be deleted." });
    }
  }

  async function handleRotateShareKey() {
    if (!draftId) return;
    if (typeof window !== "undefined" && !window.confirm("Reset this share link? The old link will stop working immediately.")) return;
    try {
      setWorking(true);
      await rotateWritingShareKey(draftId);
      await reloadDraft();
      setNotice({ tone: "success", message: "Share link reset. Copy the new link below." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Share link could not be reset." });
    } finally {
      setWorking(false);
    }
  }

  async function handleCreate(kind) {
    try {
      setWorking(true);
      if (canEdit && saveState === "dirty") await saveNow();
      const id = await createDraft(kind, authState.user);
      setSelectedIds((current) => ({ ...current, [kind]: id }));
      navigate(kind);
      setNotice({ tone: "success", message: `New ${KIND_ITEM_NOUN[kind]} created. Fill it in and publish when you are ready.` });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Could not create the item." });
    } finally {
      setWorking(false);
    }
  }

  function describeItem() {
    return itemTitle(draft);
  }

  async function handlePublish() {
    if (!canEdit || !draft) return;
    if (!String(draft.title || draft.profileName || "").trim()) {
      setNotice({ tone: "warning", message: "Give it a title before publishing." });
      return;
    }
    if ((activeSection === "faces" || activeSection === "travel") && !validateCoordinates(draft.longitude, draft.latitude).isValid) {
      setNotice({ tone: "warning", message: "Fix the longitude and latitude before publishing. If they look reversed, use the swap button in the form." });
      return;
    }
    const wasLive = draftIsLive;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(wasLive ? `Update "${describeItem()}" on the live site?` : `Publish "${describeItem()}" to the live site?`);
    if (!confirmed) return;
    try {
      setWorking(true);
      await saveNow();
      const result = await publishDraft(activeSection, draftId);
      const reloaded = await reloadDraft();
      const url = liveUrl(activeSection, reloaded);
      const canEmail = !(activeSection === "papers" && reloaded.audience && reloaded.audience !== "public");
      const actions = [];
      if (url) actions.push({ label: "View live page", onClick: () => window.open(url, "_blank", "noopener") });
      if (canEmail) actions.push({ label: "Email subscribers", onClick: () => handleOpenEmailComposer(reloaded) });
      setNotice({ tone: "success", message: wasLive ? "Live site updated." : (result?.message || "Published."), actions });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Publish failed." });
    } finally {
      setWorking(false);
    }
  }

  function handleOpenEmailComposer(source = draft) {
    if (!source) return;
    const image = source.portrait?.url || source.hero?.url || source.photos?.[0]?.url || source.coverPhoto?.url || "";
    setEmailComposer({
      kind: activeSection,
      item: {
        id: draftId,
        title: source.title || source.profileName || source.locationName || "Untitled",
        subtitle: source.subtitle || source.locationName || "",
        image,
      },
    });
  }

  function handleOpenGeneralComposer() {
    setEmailComposer({ kind: "general", item: null });
  }

  async function handleSendBroadcast(payload) {
    setSendingBroadcast(true);
    try {
      const result = await sendContentBroadcast(payload);
      if (payload.testEmail) {
        setNotice({ tone: "success", message: `Test email sent to ${payload.testEmail}.` });
      } else if (result?.failed) {
        setNotice({
          tone: "warning",
          message: `${result.succeeded} of ${result.recipientCount} emails were accepted; ${result.failed} failed. See Emails for details.`,
          actions: [{ label: "View delivery", onClick: () => navigate("emails") }],
        });
      } else {
        setNotice({
          tone: "success",
          message: `Sent to ${result?.recipientCount || 0} subscriber${result?.recipientCount === 1 ? "" : "s"}.`,
          actions: [{ label: "View delivery", onClick: () => navigate("emails") }],
        });
      }
      return result;
    } finally {
      setSendingBroadcast(false);
    }
  }

  async function handleUnpublish() {
    if (!canEdit) return;
    const confirmed =
      typeof window === "undefined"
        ? true
        : window.confirm(`Take "${describeItem()}" off the live site? Visitors will no longer see it. You can publish it again any time.`);
    if (!confirmed) return;
    try {
      setWorking(true);
      await saveNow();
      const result = await unpublishDraft(activeSection, draftId);
      await reloadDraft();
      setNotice({ tone: "success", message: result?.message || "Taken off the live site." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Unpublish failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleUpload(file, context) {
    try {
      const asset = await uploadMediaAsset(file, authState.user, context);
      setNotice({ tone: "success", message: `${file.name} uploaded.` });
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
      setNotice({ tone: "success", message: "Media details saved." });
      return asset;
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Media details could not be saved." });
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
        papersTypewriterLines: Array.isArray(saved?.papersTypewriterLines) ? saved.papersTypewriterLines.filter((line) => String(line || "").trim()) : [],
        papersWritingTypes: Array.isArray(saved?.papersWritingTypes) ? saved.papersWritingTypes.filter((type) => String(type || "").trim()) : [],
        based: String(saved?.based || ""),
        studying: String(saved?.studying || ""),
        shooting: String(saved?.shooting || ""),
        reading: String(saved?.reading || ""),
        email: String(saved?.email || ""),
      });
      setNotice({ tone: "success", message: "Site settings saved." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Site settings could not be saved." });
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
      setNotice({ tone: "success", message: result?.message || "Map pins repaired." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Map pin repair failed." });
    } finally {
      setWorking(false);
    }
  }

  async function handleDeleteDraft() {
    if (!canEdit || !draftId) return;
    if (draftIsLive) {
      setNotice({ tone: "warning", message: "Take this off the live site (More > Take off live site) before deleting it." });
      return;
    }
    const confirmed = typeof window === "undefined" ? true : window.confirm(`Delete "${describeItem()}"? This cannot be undone.`);
    if (!confirmed) return;
    try {
      setWorking(true);
      await deleteDraftRecord(activeSection, draftId);
      baselineRef.current = "";
      setDraft(null);
      setSelectedIds((current) => ({ ...current, [activeSection]: "" }));
      setSaveState("saved");
      setNotice({ tone: "success", message: "Deleted." });
    } catch (error) {
      setNotice({ tone: "error", message: error.message || "Could not delete the item." });
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
      setNotice({ tone: "error", message: error.message || "Preview could not be built." });
    }
  }

  function renderActiveForm() {
    if (!draft) return null;
    const update = (kind) => (next) => setDraft(hydrateDraft(kind, next));
    if (activeSection === "faces") return <FacesForm draft={draft} onChange={update("faces")} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "papers") return <PapersForm draft={draft} onChange={update("papers")} onUpload={handleUpload} assets={mediaAssets} paperTypeOptions={paperTypeOptions} onRotateShareKey={handleRotateShareKey} />;
    if (activeSection === "travel") return <TravelForm draft={draft} onChange={update("travel")} onUpload={handleUpload} assets={mediaAssets} />;
    if (activeSection === "photography") return <PhotographyForm draft={draft} onChange={update("photography")} onUpload={handleUpload} assets={mediaAssets} />;
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
          <h1>Admin</h1>
          <p className="admin-auth-copy">Enter your email and we will send you a one-tap sign-in link.</p>
          <input className="admin-input" type="email" value={emailInput} placeholder="you@example.com" onChange={(event) => setEmailInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleSendLink()} />
          <button type="button" className="admin-primary-button wide" onClick={handleSendLink}>Send sign-in link</button>
          <Notice notice={notice} onDismiss={dismissNotice} />
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
          <h1>Admin access needed</h1>
          <p className="admin-auth-copy">This account is signed in but does not have admin access yet. If your email is on the approved list, the button below will turn it on.</p>
          <div className="admin-button-row stacked">
            <button type="button" className="admin-primary-button wide" onClick={handleClaimAdmin} disabled={working}>Claim admin access</button>
            <button type="button" className="admin-secondary-button wide" onClick={() => refreshSession(true)}>Refresh session</button>
            <button type="button" className="admin-secondary-button wide" onClick={() => signOutAdmin()}>Sign out</button>
          </div>
          <Notice notice={notice} onDismiss={dismissNotice} />
          {authState.error ? <p className="admin-inline-error">{authState.error}</p> : null}
        </section>
      </main>
    );
  }

  const saveLabel = { saved: "All changes saved", saving: "Saving…", dirty: "Unsaved changes", error: "Save failed" }[saveState];
  const viewUrl = canEdit && draft && draftIsLive ? liveUrl(activeSection, draft) : "";
  const emailEligible = canEdit && draft && draftIsLive && !(activeSection === "papers" && draft.audience && draft.audience !== "public");

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <p>Stories From Abroad</p>
          <h1>Admin</h1>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {NAV_GROUPS.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <span className="admin-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button key={item.id} type="button" className={`admin-nav-item${activeSection === item.id ? " is-active" : ""}`} onClick={() => navigate(item.id)} aria-current={activeSection === item.id ? "page" : undefined}>
                  <span>{item.label}</span>
                  {totals[item.id] ? <small>{totals[item.id]}</small> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <p>{authState.user.email}</p>
          <button type="button" className="admin-mini-button" onClick={() => signOutAdmin()}>Sign out</button>
        </div>
      </aside>

      <section className="admin-main">
        {!isContentSection ? (
          <header className="admin-topbar">
            <h2>{SECTION_TITLES[activeSection]}</h2>
          </header>
        ) : null}

        <Notice notice={notice} onDismiss={dismissNotice} />

        {activeSection === "dashboard" ? (
          <Dashboard lists={lists} analytics={analytics} subscribers={subscribers} emailSends={emailSends} systemEmails={systemEmails} onCreate={handleCreate} onNavigate={navigate} onJump={(kind, id) => { setSelectedIds((current) => ({ ...current, [kind]: id })); navigate(kind); }} />
        ) : null}
        {activeSection === "analytics" ? <AnalyticsPanel analytics={analytics} subscribers={subscribers} emailSends={emailSends} lists={lists} verifiedOnly={isSubscriberVerified} /> : null}
        {activeSection === "subscribers" ? <SubscribersPanel subscribers={subscribers} onPromptVerify={handlePromptSubscriberVerify} promptingId={promptingSubscriberId} /> : null}
        {activeSection === "emails" ? <EmailsPanel subscribers={subscribers} emailSends={emailSends} systemEmails={systemEmails} onCompose={handleOpenGeneralComposer} working={sendingBroadcast} verifiedOnly={isSubscriberVerified} /> : null}
        {activeSection === "invites" ? <InviteCodesPanel invites={invites} onCreate={handleCreateInvite} onToggle={handleToggleInvite} onDelete={handleDeleteInvite} /> : null}
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
          <div className="admin-editor-layout">
            <CollectionList kind={activeSection} items={activeItems} selectedId={draftId} creating={working} onSelect={(id) => setSelectedIds((current) => ({ ...current, [activeSection]: id }))} onCreate={handleCreate} />
            <div className="admin-editor-main">
              {draft ? (
                <>
                  <header className="admin-actionbar">
                    <div className="admin-actionbar-title">
                      <p className="admin-kicker">{CONTENT_LABELS[activeSection]}</p>
                      <h2>{describeItem()}</h2>
                      <div className="admin-actionbar-meta">
                        <StatusPill status={draftIsLive ? "published" : "draft"} />
                        <span className={`admin-save-state is-${saveState}`}>{saveLabel}</span>
                        {draft.updatedAt ? <span className="admin-save-state">Edited {formatRelative(draft.updatedAt)}</span> : null}
                      </div>
                    </div>
                    <div className="admin-actionbar-buttons">
                      {canBuildPreview ? <button type="button" className="admin-secondary-button" onClick={handleBuildPreview} disabled={working || loadingDraft}>Preview</button> : null}
                      {viewUrl ? <a className="admin-secondary-button" href={viewUrl} target="_blank" rel="noopener noreferrer">View live</a> : null}
                      {emailEligible ? <button type="button" className="admin-secondary-button" onClick={() => handleOpenEmailComposer()} disabled={working || loadingDraft}>Email subscribers</button> : null}
                      <button type="button" className="admin-primary-button" onClick={handlePublish} disabled={working || loadingDraft}>{draftIsLive ? "Update live site" : "Publish"}</button>
                      <MoreMenu>
                        <MenuItem onClick={() => saveNow().catch(() => undefined)} disabled={working || saveState === "saved"}>Save now (Ctrl+S)</MenuItem>
                        {draftIsLive ? <MenuItem onClick={handleUnpublish} danger disabled={working}>Take off live site</MenuItem> : null}
                        <MenuItem onClick={handleDeleteDraft} danger disabled={working}>Delete</MenuItem>
                      </MoreMenu>
                    </div>
                  </header>
                  {loadingDraft ? <p className="admin-empty-inline">Loading&hellip;</p> : renderActiveForm()}
                  <DraftNotes draft={draft} onChange={(next) => setDraft(hydrateDraft(activeSection, next))} />
                  {activeSection === "photography" ? (
                    <PhotographyFeaturedManager
                      config={photographyFeaturedConfig}
                      options={photographyFeaturedOptions}
                      onChange={setPhotographyFeaturedConfig}
                      onSave={handleSavePhotographyFeatured}
                      saving={working}
                    />
                  ) : null}
                </>
              ) : (
                <EmptyState
                  title={activeItems.length ? "Select an item to edit" : `No ${KIND_ITEM_NOUN[activeSection]}s yet`}
                  action={<button type="button" className="admin-primary-button" onClick={() => handleCreate(activeSection)} disabled={working}>{NEW_LABELS[activeSection]}</button>}
                >
                  {activeItems.length ? "Choose one from the list, or start a new one." : "Create your first one to get started."}
                </EmptyState>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <EmailComposerModal
        open={Boolean(emailComposer)}
        kind={emailComposer?.kind}
        item={emailComposer?.item || null}
        subscribers={subscribers}
        authEmail={authState.user?.email || ""}
        working={sendingBroadcast}
        assets={mediaAssets}
        onUpload={handleUpload}
        verifiedOnly={isSubscriberVerified}
        onClose={() => setEmailComposer(null)}
        onSend={handleSendBroadcast}
      />
    </main>
  );
}
