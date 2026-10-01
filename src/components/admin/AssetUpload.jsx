import { useMemo, useRef, useState } from "react";
import { createMediaValue } from "../../lib/admin/schemas";
import { TextInput, ToggleField, formatBytes, formatDateInput, toIsoDateTime } from "./ui";

export const IMAGE_ACCEPT = "image/*";
export const DOCUMENT_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function stripMediaAsset(asset) {
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

export function matchesAcceptRules(item, accept = "") {
  if (!accept) return true;
  const rules = accept.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!rules.length) return true;
  const type = String(item.contentType || item.type || "");
  const fileName = String(item.fileName || item.originalName || item.name || "").toLowerCase();
  return rules.some((rule) => {
    if (rule === "image/*") return type.startsWith("image/");
    if (rule.startsWith(".")) return fileName.endsWith(rule.toLowerCase());
    return type === rule;
  });
}

function acceptLabel(accept) {
  if (accept === IMAGE_ACCEPT) return "JPG, PNG, WebP or GIF";
  if (accept === DOCUMENT_ACCEPT) return "PDF or Word document";
  return "";
}

function isImageValue(value) {
  return Boolean(value?.url) && (String(value.contentType || "").startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(value.url));
}

// Validates files against `accept` and the size cap; returns { ok: File[], errors: string[] }.
export function screenFiles(files, accept) {
  const ok = [];
  const errors = [];
  Array.from(files || []).forEach((file) => {
    if (!matchesAcceptRules(file, accept)) {
      errors.push(`${file.name} is not a supported file${acceptLabel(accept) ? ` (use ${acceptLabel(accept)})` : ""}.`);
    } else if (file.size > MAX_UPLOAD_BYTES) {
      errors.push(`${file.name} is larger than ${formatBytes(MAX_UPLOAD_BYTES)}.`);
    } else {
      ok.push(file);
    }
  });
  return { ok, errors };
}

// Click-or-drop target that always uploads from the user's computer.
export function UploadDropzone({ accept, multiple = false, disabled = false, busy = false, onFiles, title, subtitle, compact = false, children }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length && !disabled && !busy) onFiles(files);
  }

  return (
    <div
      className={`admin-dropzone${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}${compact ? " compact" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || busy}
      onClick={() => !disabled && !busy && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer?.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {children || (
        <>
          <span className="admin-dropzone-icon" aria-hidden="true">{busy ? "↻" : "↑"}</span>
          <strong>{title || (multiple ? "Drop files here or click to browse" : "Drop a file here or click to browse")}</strong>
          <small>{subtitle || acceptLabel(accept)}</small>
        </>
      )}
    </div>
  );
}

function LibraryPicker({ assets, accept, onPick, onClose }) {
  const [queryText, setQueryText] = useState("");
  const matches = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return (assets || [])
      .filter((asset) => matchesAcceptRules(asset, accept))
      .filter((asset) => !needle || [asset.title, asset.fileName, asset.originalName, asset.caption].join(" ").toLowerCase().includes(needle));
  }, [assets, accept, queryText]);
  return (
    <div className="admin-library-picker">
      <div className="admin-library-picker-head">
        <input className="admin-input" type="search" placeholder="Search your uploads" value={queryText} onChange={(event) => setQueryText(event.target.value)} autoFocus />
        <button type="button" className="admin-mini-button" onClick={onClose}>Close</button>
      </div>
      <div className="admin-asset-grid">
        {matches.length ? matches.slice(0, 48).map((asset) => (
          <button type="button" className="admin-asset-tile" key={asset.id} onClick={() => onPick(asset)}>
            {String(asset.contentType || "").startsWith("image/") ? <img src={asset.url} alt={asset.alt || asset.fileName || ""} loading="lazy" /> : <div className="admin-doc-pill">DOC</div>}
            <strong>{asset.title || asset.fileName || asset.originalName || "Unnamed"}</strong>
          </button>
        )) : <p className="admin-empty-inline">Nothing in your library matches yet.</p>}
      </div>
    </div>
  );
}

export function useUploader(onUpload, kind, field) {
  const [state, setState] = useState({ busy: false, progress: 0, name: "", errors: [] });

  async function run(files, accept, handleAsset) {
    const { ok, errors } = screenFiles(files, accept);
    setState({ busy: ok.length > 0, progress: 0, name: ok[0]?.name || "", errors });
    for (let index = 0; index < ok.length; index += 1) {
      const file = ok[index];
      setState((current) => ({ ...current, name: ok.length > 1 ? `${file.name} (${index + 1} of ${ok.length})` : file.name, progress: 0 }));
      try {
        const asset = await onUpload(file, {
          kind,
          field: ok.length > 1 ? `${field}-${index}` : field,
          onProgress: (progress) => setState((current) => ({ ...current, progress })),
        });
        await handleAsset(asset, index);
      } catch (error) {
        setState((current) => ({ ...current, errors: [...current.errors, `${file.name}: ${error?.message || "Upload failed."}`] }));
      }
    }
    setState((current) => ({ ...current, busy: false, progress: 0, name: "" }));
  }

  return { ...state, run };
}

export function UploadStatus({ uploader }) {
  return (
    <>
      {uploader.busy ? (
        <div className="admin-upload-progress" role="status">
          <div className="admin-upload-progress-bar"><span style={{ width: `${Math.max(6, Math.round(uploader.progress * 100))}%` }} /></div>
          <small>Uploading {uploader.name}&hellip; {Math.round(uploader.progress * 100)}%</small>
        </div>
      ) : null}
      {uploader.errors.map((message) => <p className="admin-inline-error" key={message}>{message}</p>)}
    </>
  );
}

export function AssetField({ label, accept = IMAGE_ACCEPT, value, assets, onChange, onUpload, kind, field, hint, compact = false }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const uploader = useUploader(onUpload, kind, field);
  const hasFile = Boolean(value?.url);
  const isImage = isImageValue(value);

  function applyAsset(asset) {
    onChange(stripMediaAsset(asset));
    setLibraryOpen(false);
  }

  const upload = (files) => uploader.run(files.slice(0, 1), accept, async (asset) => applyAsset(asset));

  return (
    <section className={`admin-asset-field${compact ? " compact" : ""}`}>
      <div className="admin-asset-field-head">
        <div>
          <h4>{label}</h4>
          {hint ? <p>{hint}</p> : null}
        </div>
        <div className="admin-button-row compact">
          <button type="button" className="admin-mini-button" onClick={() => setLibraryOpen((open) => !open)}>
            {libraryOpen ? "Hide library" : "Choose from library"}
          </button>
          {hasFile ? <button type="button" className="admin-mini-button danger" onClick={() => onChange(createMediaValue())}>Remove</button> : null}
        </div>
      </div>

      {hasFile ? (
        <div className="admin-asset-current">
          {isImage ? (
            <img src={value.url} alt={value.alt || label} className="admin-asset-preview-image" />
          ) : (
            <div className="admin-asset-preview-file">
              <strong>{value.fileName || "Attached file"}</strong>
              <span>{value.contentType || "Document"}</span>
            </div>
          )}
          <div className="admin-asset-current-side">
            <strong>{value.title || value.fileName || "Uploaded file"}</strong>
            <small>{value.fileName}</small>
            <UploadDropzone accept={accept} compact busy={uploader.busy} onFiles={upload} title="Replace file" subtitle="Drop or click" />
          </div>
        </div>
      ) : (
        <UploadDropzone accept={accept} busy={uploader.busy} onFiles={upload} />
      )}

      <UploadStatus uploader={uploader} />

      {libraryOpen ? <LibraryPicker assets={assets} accept={accept} onPick={applyAsset} onClose={() => setLibraryOpen(false)} /> : null}

      {hasFile ? (
        <details className="admin-asset-details">
          <summary>{kind === "photography" ? "Photo details (caption, location, camera info)" : "Description and caption"}</summary>
          <div className="admin-grid two-up">
            <TextInput label="Alt text" hint="Describes the image for screen readers." value={value?.alt || ""} onChange={(next) => onChange({ ...value, alt: next })} />
            <TextInput label="Title" value={value?.title || ""} onChange={(next) => onChange({ ...value, title: next })} />
            <TextInput label="Caption" value={value?.caption || ""} onChange={(next) => onChange({ ...value, caption: next })} />
            {kind === "photography" ? (
              <>
                <TextInput label="Location" value={value?.locationLabel || ""} onChange={(next) => onChange({ ...value, locationLabel: next })} />
                <TextInput label="Date taken" type="date" value={formatDateInput(value?.exifDate)} onChange={(next) => onChange({ ...value, exifDate: toIsoDateTime(next) })} />
                <TextInput label="Short quote (bottom)" value={value?.shortQuote || ""} onChange={(next) => onChange({ ...value, shortQuote: next })} />
                <TextInput label="Camera" value={value?.cameraModel || ""} onChange={(next) => onChange({ ...value, cameraModel: next })} />
                <TextInput label="Lens" value={value?.lens || ""} onChange={(next) => onChange({ ...value, lens: next })} />
                <TextInput label="Shutter" placeholder="1/250s" value={value?.shutter || ""} onChange={(next) => onChange({ ...value, shutter: next })} />
                <TextInput label="Aperture" placeholder="f/2.8" value={value?.aperture || ""} onChange={(next) => onChange({ ...value, aperture: next })} />
                <TextInput label="ISO" placeholder="400" value={value?.iso || ""} onChange={(next) => onChange({ ...value, iso: next })} />
              </>
            ) : null}
          </div>
          {kind === "photography" ? (
            <ToggleField label="Show camera details on the public page" checked={value?.metadataEnabled !== false} onChange={(next) => onChange({ ...value, metadataEnabled: next })} />
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

// Upload one or many images straight into a list of media values (galleries, shoots).
export function MultiUploadZone({ accept = IMAGE_ACCEPT, kind, field, onUpload, onAssets, label = "Drop photos here or click to add several at once" }) {
  const uploader = useUploader(onUpload, kind, field);
  return (
    <>
      <UploadDropzone
        accept={accept}
        multiple
        busy={uploader.busy}
        compact
        title={label}
        subtitle={acceptLabel(accept)}
        onFiles={(files) => {
          const collected = [];
          uploader.run(files, accept, async (asset) => {
            collected.push(stripMediaAsset(asset));
          }).then(() => {
            if (collected.length) onAssets(collected);
          });
        }}
      />
      <UploadStatus uploader={uploader} />
    </>
  );
}
