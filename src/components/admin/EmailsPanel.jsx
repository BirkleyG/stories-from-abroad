import { useEffect, useMemo, useState } from "react";
import { CONTENT_LABELS, createMediaValue } from "../../lib/admin/schemas";
import { subscribeEmailRecipients } from "../../lib/admin/repository";
import { AssetField } from "./AssetUpload";
import { EmptyState, StatTile, StatusPill, TextArea, TextInput, formatNumber, formatRelative, formatStamp } from "./ui";

const SEGMENT_BY_KIND = {
  papers: "Articles & Op-Eds",
  photography: "Photography",
  faces: "Faces of the World",
  travel: "Travel",
};

function kindLabel(send) {
  return send.kind && send.kind !== "general" ? (CONTENT_LABELS[send.kind] || send.kind) : "General announcement";
}

function sendSummary(send) {
  const total = Number(send.recipientCount || 0);
  const accepted = Number(send.succeeded || 0);
  const failed = Number(send.failed || 0);
  if (send.status === "sending") return `Sending… ${accepted + failed} of ${total} processed`;
  if (send.test) return send.status === "failed" ? "Test email failed" : `Test sent to ${send.testRecipient || "you"}`;
  if (failed) return `${accepted} accepted, ${failed} failed`;
  return `${accepted} of ${total} accepted`;
}

function RecipientTable({ sendId, send }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState("all");
  const [queryText, setQueryText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(null);
    return subscribeEmailRecipients(sendId, setRows, (err) => setError(err.message || "Could not load recipients."));
  }, [sendId]);

  const view = useMemo(() => {
    const list = [...(rows || [])].sort((left, right) => String(left.email).localeCompare(String(right.email)));
    const needle = queryText.trim().toLowerCase();
    const matches = (row) => {
      if (needle && !`${row.email} ${row.name}`.toLowerCase().includes(needle)) return false;
      if (filter === "problems") return ["failed", "bounced", "complained"].includes(row.status);
      if (filter === "opened") return Boolean(row.openedAt);
      if (filter === "unopened") return !row.openedAt && !["failed", "bounced", "complained"].includes(row.status);
      return true;
    };
    return {
      list: list.filter(matches),
      total: list.length,
      problems: list.filter((row) => ["failed", "bounced", "complained"].includes(row.status)).length,
      opened: list.filter((row) => row.openedAt).length,
      delivered: list.filter((row) => row.status === "delivered" || row.openedAt).length,
    };
  }, [rows, filter, queryText]);

  if (error) return <p className="admin-inline-error">{error}</p>;
  if (!rows) return <p className="admin-empty-inline">Loading recipients&hellip;</p>;

  const rowStatus = (row) => (row.openedAt && row.status !== "bounced" ? "opened" : row.status);

  return (
    <div className="admin-send-detail">
      <div className="admin-stat-grid compact">
        <StatTile value={`${view.total - view.problems}/${view.total}`} label="Accepted by mail provider" />
        <StatTile value={view.delivered || (send.delivered ?? 0)} label="Confirmed delivered" hint={send.delivered === undefined && !view.delivered ? "Needs the delivery webhook" : ""} />
        <StatTile value={view.opened} label="Opened" hint={view.total ? `${Math.round((view.opened / view.total) * 100)}% of recipients` : ""} />
        <StatTile value={view.problems} label="Failed or bounced" tone={view.problems ? "bad" : ""} />
      </div>
      <div className="admin-toolbar">
        <div className="admin-segmented">
          {[["all", "Everyone"], ["problems", "Problems"], ["opened", "Opened"], ["unopened", "Not opened"]].map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? "is-active" : ""} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
        <input className="admin-input admin-search" type="search" placeholder="Search recipients" value={queryText} onChange={(event) => setQueryText(event.target.value)} />
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Recipient</th><th>Status</th><th>Opened</th><th>Details</th></tr></thead>
          <tbody>
            {view.list.map((row) => (
              <tr key={row.id}>
                <td>{row.email}{row.name ? <small className="admin-cell-sub">{row.name}</small> : null}</td>
                <td><StatusPill status={rowStatus(row)} /></td>
                <td>{row.openedAt ? `${formatStamp(row.openedAt)}${row.opens > 1 ? ` (${row.opens}x)` : ""}` : "—"}</td>
                <td className="admin-cell-error">{row.error || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!view.list.length ? <p className="admin-empty-inline">No recipients match.</p> : null}
      </div>
    </div>
  );
}

function BroadcastHistory({ emailSends }) {
  const [openId, setOpenId] = useState("");
  const [showTests, setShowTests] = useState(false);
  const sends = emailSends.filter((send) => showTests || !send.test);
  if (!emailSends.length) {
    return <EmptyState title="Nothing sent yet">Every email you send to subscribers will appear here with its delivery status.</EmptyState>;
  }
  return (
    <div className="admin-send-list">
      <label className="admin-inline-check">
        <input type="checkbox" checked={showTests} onChange={(event) => setShowTests(event.target.checked)} /> Show test sends
      </label>
      {sends.map((send) => {
        const expanded = openId === send.id;
        const canDrill = !send.test && send.status !== "queued";
        return (
          <article className={`admin-send-card${expanded ? " is-open" : ""}`} key={send.id}>
            <button type="button" className="admin-send-row" onClick={() => canDrill && setOpenId(expanded ? "" : send.id)} aria-expanded={expanded} disabled={!canDrill}>
              <div className="admin-send-main">
                <strong>{send.subject}</strong>
                <span>{kindLabel(send)} {"·"} {formatStamp(send.sentAt, { empty: "Just now" })}{send.sentBy ? ` · ${send.sentBy}` : ""}</span>
              </div>
              <div className="admin-send-meta">
                <span>{sendSummary(send)}</span>
                {!send.test && send.status !== "sending" ? <span>{formatNumber(send.uniqueOpens || 0)} opened</span> : null}
              </div>
              <div className="admin-send-state">
                {send.test ? <StatusPill status="test" /> : null}
                <StatusPill status={send.status || "sent"} />
              </div>
            </button>
            {send.error && send.status !== "sent" ? <p className="admin-send-error">{send.error}</p> : null}
            {expanded ? <RecipientTable sendId={send.id} send={send} /> : null}
          </article>
        );
      })}
    </div>
  );
}

function SystemEmails({ items }) {
  if (!items.length) return <EmptyState title="No sign-in emails logged yet">Confirmation emails sent to new subscribers will show here, including any that fail to send.</EmptyState>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>When</th><th>To</th><th>Email</th><th>Status</th><th>Details</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{formatStamp(item.createdAt)}</td>
              <td>{item.to || "Unknown"}</td>
              <td>{item.type === "verification" ? "Subscription confirmation" : item.subject}</td>
              <td><StatusPill status={item.status === "sent" ? "sent" : "failed"} /></td>
              <td className="admin-cell-error">{item.error || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EmailsPanel({ subscribers, emailSends, systemEmails, onCompose, working, verifiedOnly }) {
  const [tab, setTab] = useState("broadcasts");
  const verified = subscribers.filter(verifiedOnly).length;
  const real = emailSends.filter((send) => !send.test);
  const last = real[0];
  const failedSystem = systemEmails.filter((item) => item.status !== "sent").length;
  return (
    <div className="admin-emails">
      <section className="admin-section">
        <header className="admin-section-header">
          <div>
            <h3>Send an announcement</h3>
            <p>A standalone update to every verified subscriber. To email about a specific story, open it and use &ldquo;Email subscribers&rdquo; once it is live.</p>
          </div>
          <button type="button" className="admin-primary-button" onClick={onCompose} disabled={working}>Compose announcement</button>
        </header>
        <div className="admin-section-body">
          <div className="admin-stat-grid">
            <StatTile value={formatNumber(verified)} label="Verified subscribers" />
            <StatTile value={formatNumber(real.length)} label="Emails sent" />
            <StatTile value={last ? <StatusPill status={last.status || "sent"} /> : "—"} label="Most recent" hint={last ? `${last.subject} · ${formatRelative(last.sentAt) || "just now"}` : ""} />
            <StatTile value={formatNumber(failedSystem)} label="Failed sign-in emails" tone={failedSystem ? "bad" : ""} />
          </div>
        </div>
      </section>

      <section className="admin-section">
        <header className="admin-section-header">
          <div className="admin-segmented" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "broadcasts"} className={tab === "broadcasts" ? "is-active" : ""} onClick={() => setTab("broadcasts")}>Broadcasts</button>
            <button type="button" role="tab" aria-selected={tab === "system"} className={tab === "system" ? "is-active" : ""} onClick={() => setTab("system")}>Sign-in emails</button>
          </div>
        </header>
        <div className="admin-section-body">
          {tab === "broadcasts" ? <BroadcastHistory emailSends={emailSends} /> : <SystemEmails items={systemEmails} />}
        </div>
      </section>
    </div>
  );
}

export function EmailComposerModal({ open, kind, item, subscribers, authEmail, working, assets, onUpload, onClose, onSend, verifiedOnly }) {
  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [hero, setHero] = useState(createMediaValue());
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [body, setBody] = useState("");
  const [pullQuote, setPullQuote] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [localError, setLocalError] = useState("");
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(kind === "general" ? "" : (item?.title ? `New from Stories From Abroad: ${item.title}` : ""));
    setNote("");
    setHero(createMediaValue());
    setCtaLabel("");
    setCtaUrl("");
    setSubtitle("");
    setBody("");
    setPullQuote("");
    setConfirmingSend(false);
    setLocalError("");
    setSendingTest(false);
    setSending(false);
    setTestSent(false);
  }, [open, kind, item?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const recipientCount = useMemo(() => {
    const verified = subscribers.filter(verifiedOnly);
    const segment = SEGMENT_BY_KIND[kind];
    if (!segment) return verified.length;
    return verified.filter((subscriber) => {
      const tags = Array.isArray(subscriber.segmentTags) ? subscriber.segmentTags : [];
      const prefs = Array.isArray(subscriber.preferences) ? subscriber.preferences : [];
      return tags.includes(segment) || prefs.includes("all");
    }).length;
  }, [subscribers, kind, verifiedOnly]);

  if (!open) return null;

  const basePayload = kind === "general"
    ? { kind: "general", subject: subject.trim(), note, heroUrl: hero.url || "", heroAlt: hero.alt || "", ctaLabel: ctaLabel.trim(), ctaUrl: ctaUrl.trim(), subtitle: subtitle.trim(), body, pullQuote: pullQuote.trim() }
    : { kind, id: item?.id, subject: subject.trim(), note };

  async function handleTestSend() {
    if (!subject.trim()) return setLocalError("Add a subject line first.");
    if (!authEmail) return setLocalError("No signed-in admin email available for the test send.");
    setLocalError("");
    setSendingTest(true);
    try {
      await onSend({ ...basePayload, testEmail: authEmail });
      setTestSent(true);
    } catch (error) {
      setLocalError(error.message || "Test send failed.");
    } finally {
      setSendingTest(false);
    }
  }

  async function handleRealSend() {
    if (!subject.trim()) return setLocalError("Add a subject line first.");
    if (!confirmingSend) {
      setConfirmingSend(true);
      return;
    }
    setLocalError("");
    setSending(true);
    try {
      await onSend(basePayload);
      onClose();
    } catch (error) {
      setLocalError(error.message || "Send failed.");
      setConfirmingSend(false);
    } finally {
      setSending(false);
    }
  }

  const sendDisabled = working || sending || !recipientCount;

  return (
    <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label="Compose subscriber email" onMouseDown={(event) => event.target === event.currentTarget && !sending && onClose()}>
      <section className="admin-modal">
        <header className="admin-modal-head">
          <div>
            <p className="admin-kicker">{kind === "general" ? "Announcement" : `${CONTENT_LABELS[kind]} update`}</p>
            <h2>Compose email</h2>
          </div>
          <button type="button" className="admin-mini-button" onClick={onClose} disabled={sending}>Close</button>
        </header>
        <div className="admin-modal-body">
          {item ? (
            <div className="admin-email-preview-card">
              {item.image ? <img src={item.image} alt="" /> : null}
              <div>
                <strong>{item.title}</strong>
                {item.subtitle ? <p>{item.subtitle}</p> : null}
              </div>
            </div>
          ) : null}
          <TextInput label={kind === "general" ? "Subject line / headline" : "Subject line"} value={subject} onChange={setSubject} placeholder="What's the headline?" hint={`${subject.length} characters. Under about 60 reads best in an inbox.`} />
          {kind === "general" ? <TextInput label="Subtitle (optional)" hint="Shown as a bold second headline line." value={subtitle} onChange={setSubtitle} placeholder="e.g. Stories from Abroad" /> : null}
          <TextArea
            label={kind === "general" ? "A note from BTG" : "Add a note (optional)"}
            value={note}
            onChange={setNote}
            rows={6}
            placeholder={kind === "general" ? "Write the announcement..." : "Anything you'd like to add above the published content..."}
          />
          {kind === "general" ? (
            <>
              <TextArea label="Dispatch body (optional)" hint="Shown under the This Dispatch heading. Leave blank to skip that section." value={body} onChange={setBody} rows={5} />
              <TextInput label="Pull quote (optional)" value={pullQuote} onChange={setPullQuote} />
              <AssetField label="Header image (optional)" hint="Upload an image from your computer." accept="image/*" value={hero} assets={assets} onUpload={onUpload} onChange={setHero} kind="email" field="email-hero" compact />
              <div className="admin-grid two-up">
                <TextInput label="Button label (optional)" value={ctaLabel} onChange={setCtaLabel} placeholder="Visit the Site" />
                <TextInput label="Button link (optional)" value={ctaUrl} onChange={setCtaUrl} placeholder="https://..." />
              </div>
            </>
          ) : null}
          <p className="admin-field-hint">
            Will be sent to <strong>{recipientCount}</strong> verified subscriber{recipientCount === 1 ? "" : "s"}
            {SEGMENT_BY_KIND[kind] ? ` following ${SEGMENT_BY_KIND[kind]}` : ""}. You can follow delivery under Emails afterwards.
          </p>
          {testSent ? <p className="admin-inline-ok">Test sent to {authEmail}. Check your inbox, then send to everyone.</p> : null}
          {localError ? <p className="admin-inline-error">{localError}</p> : null}
        </div>
        <footer className="admin-modal-actions">
          <button type="button" className="admin-secondary-button" onClick={handleTestSend} disabled={working || sendingTest || sending}>
            {sendingTest ? "Sending test..." : "Send test to me"}
          </button>
          <button type="button" className={`admin-primary-button${confirmingSend ? " danger" : ""}`} onClick={handleRealSend} disabled={sendDisabled}>
            {sending ? "Sending..." : confirmingSend ? `Confirm: send to ${recipientCount}` : `Send to ${recipientCount} subscriber${recipientCount === 1 ? "" : "s"}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
