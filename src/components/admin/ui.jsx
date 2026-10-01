import { useEffect, useRef, useState } from "react";

export function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatStamp(value, opts = {}) {
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

export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return "";
  const deltaMs = Date.now() - date.getTime();
  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 45) return `${days}d ago`;
  return formatStamp(date, { dateOnly: true });
}

export function formatBytes(value) {
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

export function formatDateInput(value) {
  const date = toDate(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function toIsoDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

export function isLive(item) {
  return item?.status === "published" || Boolean(item?.publishedRecord?.slug);
}

const STATUS_LABELS = {
  published: "Live",
  draft: "Not live",
  review: "Not live",
  scheduled: "Not live",
  archived: "Not live",
  verified: "Verified",
  "not verified": "Not verified",
  sending: "Sending",
  sent: "Sent",
  partial: "Partly sent",
  failed: "Failed",
  queued: "Queued",
  delivered: "Delivered",
  delayed: "Delayed",
  bounced: "Bounced",
  complained: "Spam report",
  opened: "Opened",
  clicked: "Clicked",
  test: "Test",
};

const STATUS_TONES = {
  published: "good",
  verified: "good",
  sent: "good",
  delivered: "good",
  opened: "good",
  clicked: "good",
  draft: "muted",
  review: "muted",
  scheduled: "muted",
  archived: "muted",
  queued: "muted",
  test: "muted",
  "not verified": "warn",
  sending: "warn",
  partial: "warn",
  delayed: "warn",
  failed: "bad",
  bounced: "bad",
  complained: "bad",
};

export function StatusPill({ status, label }) {
  const tone = STATUS_TONES[status] || "muted";
  return <span className={`admin-pill admin-pill-${tone}`}>{label || STATUS_LABELS[status] || status}</span>;
}

export function Notice({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice || notice.tone === "error" || notice.tone === "warning" || notice.sticky) return undefined;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);
  if (!notice) return null;
  return (
    <div className={`admin-notice admin-notice-${notice.tone || "info"}`} role="status">
      <span>{notice.message}</span>
      <span className="admin-notice-actions">
        {notice.actions?.map((action) => (
          <button key={action.label} type="button" className="admin-notice-action" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
        <button type="button" className="admin-notice-close" onClick={onDismiss} aria-label="Dismiss message">
          &times;
        </button>
      </span>
    </div>
  );
}

export function TextInput({ label, hint, value, onChange, placeholder = "", type = "text", maxLength }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      <input className="admin-input" type={type} value={value || ""} placeholder={placeholder} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
    </label>
  );
}

export function ToggleField({ label, checked, onChange, hint }) {
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

export function SelectField({ label, hint, value, onChange, options }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
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
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, hint, value, onChange, rows = 4, placeholder = "" }) {
  return (
    <label className="admin-field">
      <span className="admin-field-label">{label}</span>
      <textarea className="admin-textarea" value={value || ""} rows={rows} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="admin-field-hint">{hint}</span> : null}
    </label>
  );
}

// A titled group of fields. `collapsible` sections use <details> so long forms stay scannable.
export function Section({ title, description, actions, children, collapsible = false, defaultOpen = true, className = "" }) {
  if (collapsible) {
    return (
      <details className={`admin-section admin-section-collapsible ${className}`} open={defaultOpen}>
        <summary>
          <span>
            <strong>{title}</strong>
            {description ? <small>{description}</small> : null}
          </span>
        </summary>
        <div className="admin-section-body">{children}</div>
      </details>
    );
  }
  return (
    <section className={`admin-section ${className}`}>
      <header className="admin-section-header">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="admin-button-row compact">{actions}</div> : null}
      </header>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

// Small dropdown for rarely used or destructive actions.
export function MoreMenu({ children, label = "More" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="admin-menu" ref={ref}>
      <button type="button" className="admin-secondary-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label} <span aria-hidden="true">&#9662;</span>
      </button>
      {open ? (
        <div className="admin-menu-list" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({ children, onClick, danger = false, disabled = false }) {
  return (
    <button type="button" role="menuitem" className={`admin-menu-item${danger ? " danger" : ""}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="admin-empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function StatTile({ value, label, hint, tone }) {
  return (
    <article className={`admin-stat-card${tone ? ` tone-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
    </article>
  );
}

export function copyText(text) {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return Promise.reject(new Error("Clipboard unavailable"));
  }
}
