import { useMemo, useState } from "react";
import { CONTENT_LABELS } from "../../lib/admin/schemas";
import { EmptyState, StatTile, formatNumber, formatStamp, toDate } from "./ui";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const PAGE_LABELS = {
  "/": "Home",
  "/selected-papers/": "Selected Papers",
  "/photography/": "Photography",
  "/travel-stories/": "Travel Dispatches",
  "/faces-of-the-world/": "Faces of the World",
  "/read-the-story/": "About / Read the Story",
  "/subscriber-settings/": "Subscriber settings",
  "/unsubscribe/": "Unsubscribe",
  "/email-verified/": "Email verified",
};

const SOURCE_LABELS = { email: "Email links" };

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDays(count) {
  const days = [];
  const today = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    days.push(dayKey(date));
  }
  return days;
}

function sumMaps(docs, field) {
  const totals = {};
  docs.forEach((doc) => {
    Object.entries(doc?.[field] || {}).forEach(([key, value]) => {
      totals[key] = (totals[key] || 0) + Number(value || 0);
    });
  });
  return Object.entries(totals).sort((left, right) => right[1] - left[1]);
}

function delta(current, previous) {
  if (!previous) return current ? "New" : "";
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs previous period`;
}

function shortDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function niceMax(value) {
  if (value <= 5) return 5;
  const power = 10 ** Math.floor(Math.log10(value));
  const scaled = value / power;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * power;
}

// Bars for the primary series, optional line for a second series. Pure SVG, no dependencies.
function TrendChart({ labels, bars, line, barLabel, lineLabel, area = false, height = 220 }) {
  const [hover, setHover] = useState(-1);
  const width = 720;
  const pad = { top: 14, right: 12, bottom: 26, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(1, ...(bars || []), ...(line || [])));
  const count = labels.length;
  const step = innerW / Math.max(1, count);
  const x = (index) => pad.left + step * index + step / 2;
  const y = (value) => pad.top + innerH - (value / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));
  const labelEvery = Math.ceil(count / 8);
  const linePoints = line ? line.map((value, index) => `${x(index)},${y(value)}`).join(" ") : "";
  const areaPath = area && line && line.length
    ? `M ${x(0)},${pad.top + innerH} L ${line.map((value, index) => `${x(index)},${y(value)}`).join(" L ")} L ${x(count - 1)},${pad.top + innerH} Z`
    : "";

  return (
    <div className="admin-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${barLabel || lineLabel} over time`} onMouseLeave={() => setHover(-1)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="admin-chart-grid" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="admin-chart-axis">{formatNumber(tick)}</text>
          </g>
        ))}
        {bars ? bars.map((value, index) => (
          <rect
            key={labels[index]}
            x={x(index) - Math.max(1.5, step * 0.34)}
            width={Math.max(3, step * 0.68)}
            y={y(value)}
            height={Math.max(value ? 1.5 : 0, pad.top + innerH - y(value))}
            rx="1.5"
            className={`admin-chart-bar${hover === index ? " is-hover" : ""}`}
          />
        )) : null}
        {areaPath ? <path d={areaPath} className="admin-chart-area" /> : null}
        {line ? <polyline points={linePoints} className="admin-chart-line" fill="none" /> : null}
        {line && count <= 40 ? line.map((value, index) => <circle key={labels[index]} cx={x(index)} cy={y(value)} r="2.6" className="admin-chart-dot" />) : null}
        {labels.map((label, index) => (
          index % labelEvery === 0 || index === count - 1 ? (
            <text key={label} x={x(index)} y={height - 8} textAnchor="middle" className="admin-chart-axis">{shortDate(label)}</text>
          ) : null
        ))}
        {labels.map((label, index) => (
          <rect key={`hit-${label}`} x={pad.left + step * index} y={pad.top} width={step} height={innerH} fill="transparent" onMouseEnter={() => setHover(index)} />
        ))}
        {hover >= 0 ? <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} className="admin-chart-cursor" /> : null}
      </svg>
      {hover >= 0 ? (
        <div className="admin-chart-tip" style={{ left: `${Math.min(88, Math.max(12, (x(hover) / width) * 100))}%` }}>
          <strong>{shortDate(labels[hover])}</strong>
          {bars ? <span><i className="swatch bar" /> {barLabel}: {formatNumber(bars[hover])}</span> : null}
          {line ? <span><i className="swatch line" /> {lineLabel}: {formatNumber(line[hover])}</span> : null}
        </div>
      ) : null}
      <div className="admin-chart-legend">
        {bars ? <span><i className="swatch bar" /> {barLabel}</span> : null}
        {line ? <span><i className="swatch line" /> {lineLabel}</span> : null}
      </div>
    </div>
  );
}

function RankList({ rows, empty }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <p className="admin-empty-inline">{empty}</p>;
  return (
    <ol className="admin-rank-list">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="admin-rank-row">
            <span className="admin-rank-label">{row.label}{row.sub ? <small>{row.sub}</small> : null}</span>
            <strong>{formatNumber(row.value)}</strong>
          </div>
          <div className="admin-rank-bar"><span style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

function resolveItem(key, lists) {
  const [kind, slug] = key.split(":");
  const pool = lists?.[kind] || [];
  const found = pool.find((item) => (item.publishedRecord?.slug || item.slug) === slug);
  return {
    kind,
    title: found ? (found.title || found.profileName || found.locationName || slug) : slug.replace(/-/g, " "),
    removed: !found,
  };
}

export default function AnalyticsPanel({ analytics, subscribers, emailSends, lists, verifiedOnly }) {
  const [rangeDays, setRangeDays] = useState(30);

  const view = useMemo(() => {
    const days = buildDays(rangeDays);
    const previousDays = buildDays(rangeDays * 2).slice(0, rangeDays);
    const byDay = new Map(analytics.map((doc) => [doc.id, doc]));
    const docs = days.map((day) => byDay.get(day) || { id: day });
    const previousDocs = previousDays.map((day) => byDay.get(day) || { id: day });
    const views = docs.map((doc) => Number(doc.views || 0));
    const visitors = docs.map((doc) => Number(doc.uniques || 0));
    const totalViews = views.reduce((sum, value) => sum + value, 0);
    const totalVisitors = visitors.reduce((sum, value) => sum + value, 0);
    const previousViews = previousDocs.reduce((sum, doc) => sum + Number(doc.views || 0), 0);
    const previousVisitors = previousDocs.reduce((sum, doc) => sum + Number(doc.uniques || 0), 0);

    const verified = subscribers.filter(verifiedOnly);
    const cutoff = new Date(`${days[0]}T00:00:00Z`).getTime();
    const previousCutoff = new Date(`${previousDays[0]}T00:00:00Z`).getTime();
    const joinedDay = (subscriber) => {
      const date = toDate(subscriber.createdAt);
      return date ? dayKey(date) : "";
    };
    let running = verified.filter((subscriber) => {
      const date = toDate(subscriber.createdAt);
      return date && date.getTime() < cutoff;
    }).length;
    const newPerDay = new Map();
    verified.forEach((subscriber) => {
      const key = joinedDay(subscriber);
      if (key) newPerDay.set(key, (newPerDay.get(key) || 0) + 1);
    });
    const subscriberTotals = days.map((day) => {
      running += newPerDay.get(day) || 0;
      return running;
    });
    const newInRange = days.reduce((sum, day) => sum + (newPerDay.get(day) || 0), 0);
    const newInPrevious = verified.filter((subscriber) => {
      const date = toDate(subscriber.createdAt);
      return date && date.getTime() >= previousCutoff && date.getTime() < cutoff;
    }).length;

    const pages = sumMaps(docs, "pages").map(([key, value]) => ({
      key,
      label: PAGE_LABELS[key.replace(/_/g, "/")] || PAGE_LABELS[key] || key.replace(/_/g, "/"),
      value,
    }));
    const items = sumMaps(docs, "items").map(([key, value]) => {
      const resolved = resolveItem(key, lists);
      return {
        key,
        label: resolved.title,
        sub: `${CONTENT_LABELS[resolved.kind] || resolved.kind}${resolved.removed ? " (not in admin)" : ""}`,
        value,
      };
    });
    const referrers = sumMaps(docs, "referrers").map(([key, value]) => ({ key, label: key === "direct" ? "Direct / unknown" : key.replace(/_/g, "."), value }));
    const sources = sumMaps(docs, "sources").map(([key, value]) => ({ key, label: SOURCE_LABELS[key] || key, value }));
    const emailVisits = sources.find((row) => row.key === "email")?.value || 0;

    const segmentCounts = ["Articles & Op-Eds", "Photography", "Faces of the World", "Travel"].map((segment) => ({
      key: segment,
      label: segment,
      value: verified.filter((subscriber) => {
        const tags = Array.isArray(subscriber.segmentTags) ? subscriber.segmentTags : [];
        const prefs = Array.isArray(subscriber.preferences) ? subscriber.preferences : [];
        return tags.includes(segment) || prefs.includes("all");
      }).length,
    }));

    const emails = emailSends
      .filter((send) => !send.test)
      .slice(0, 8)
      .map((send) => {
        const reached = Number(send.succeeded || 0);
        const opened = Number(send.uniqueOpens || 0);
        return { ...send, reached, opened, rate: reached ? Math.round((opened / reached) * 100) : 0 };
      });
    const sentInRange = emailSends.filter((send) => {
      const date = toDate(send.sentAt);
      return !send.test && date && date.getTime() >= cutoff;
    });
    const reachedTotal = sentInRange.reduce((sum, send) => sum + Number(send.succeeded || 0), 0);
    const openedTotal = sentInRange.reduce((sum, send) => sum + Number(send.uniqueOpens || 0), 0);

    return {
      days, views, visitors, totalViews, totalVisitors, previousViews, previousVisitors,
      subscriberTotals, newInRange, newInPrevious, totalSubscribers: verified.length,
      pages: pages.slice(0, 8), items: items.slice(0, 10), referrers: referrers.slice(0, 8),
      emailVisits, segmentCounts, emails, sentInRange: sentInRange.length,
      openRate: reachedTotal ? Math.round((openedTotal / reachedTotal) * 100) : null,
      hasData: analytics.length > 0,
    };
  }, [analytics, subscribers, emailSends, lists, rangeDays, verifiedOnly]);

  return (
    <div className="admin-analytics">
      <div className="admin-toolbar">
        <div className="admin-segmented" role="tablist" aria-label="Date range">
          {RANGES.map((range) => (
            <button key={range.days} type="button" role="tab" aria-selected={rangeDays === range.days} className={rangeDays === range.days ? "is-active" : ""} onClick={() => setRangeDays(range.days)}>
              {range.label}
            </button>
          ))}
        </div>
        <small className="admin-field-hint">Dates are in UTC. Your own visits from this browser and from localhost are not counted.</small>
      </div>

      <div className="admin-stat-grid">
        <StatTile value={formatNumber(view.totalViews)} label="Page views" hint={delta(view.totalViews, view.previousViews)} />
        <StatTile value={formatNumber(view.totalVisitors)} label="Visitors" hint={delta(view.totalVisitors, view.previousVisitors)} />
        <StatTile value={formatNumber(view.totalSubscribers)} label="Verified subscribers" hint={`${view.newInRange >= 0 ? "+" : ""}${view.newInRange} in this period${view.newInPrevious ? ` (${delta(view.newInRange, view.newInPrevious).replace(" vs previous period", "")} vs before)` : ""}`} />
        <StatTile value={view.openRate === null ? "—" : `${view.openRate}%`} label="Email open rate" hint={view.sentInRange ? `${view.sentInRange} email${view.sentInRange === 1 ? "" : "s"} sent` : "No emails sent in this period"} />
        <StatTile value={formatNumber(view.emailVisits)} label="Visits from emails" hint="Clicks that landed on the site" />
      </div>

      {!view.hasData ? (
        <EmptyState title="No visits recorded yet">
          Page views appear here once the updated site and Cloud Functions are deployed and someone (other than you) visits a page.
        </EmptyState>
      ) : null}

      <section className="admin-section">
        <header className="admin-section-header"><div><h3>Traffic</h3><p>Page views and daily visitors on the public site.</p></div></header>
        <div className="admin-section-body">
          <TrendChart labels={view.days} bars={view.views} line={view.visitors} barLabel="Page views" lineLabel="Visitors" />
        </div>
      </section>

      <section className="admin-section">
        <header className="admin-section-header"><div><h3>Subscribers over time</h3><p>Verified subscriber count at the end of each day.</p></div></header>
        <div className="admin-section-body">
          <TrendChart labels={view.days} line={view.subscriberTotals} lineLabel="Verified subscribers" area height={190} />
        </div>
      </section>

      <div className="admin-two-col">
        <section className="admin-section">
          <header className="admin-section-header"><div><h3>Top stories and pages</h3><p>Individual pieces people opened.</p></div></header>
          <div className="admin-section-body">
            <RankList rows={view.items} empty="Once readers open individual stories, shoots, papers and profiles they will rank here." />
          </div>
        </section>
        <section className="admin-section">
          <header className="admin-section-header"><div><h3>Sections</h3><p>Page views by site section.</p></div></header>
          <div className="admin-section-body">
            <RankList rows={view.pages} empty="No page views yet." />
          </div>
        </section>
        <section className="admin-section">
          <header className="admin-section-header"><div><h3>Where visitors come from</h3><p>Referring sites.</p></div></header>
          <div className="admin-section-body">
            <RankList rows={view.referrers} empty="No referrers yet." />
          </div>
        </section>
        <section className="admin-section">
          <header className="admin-section-header"><div><h3>Subscribers by interest</h3><p>Verified subscribers following each section.</p></div></header>
          <div className="admin-section-body">
            <RankList rows={view.segmentCounts} empty="No subscribers yet." />
          </div>
        </section>
      </div>

      <section className="admin-section">
        <header className="admin-section-header"><div><h3>Email performance</h3><p>Opens are counted with a tiny tracking image, so they undercount readers who block images and can overcount where mail apps preload them.</p></div></header>
        <div className="admin-section-body">
          {view.emails.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Email</th><th>Sent</th><th>Delivered to provider</th><th>Opened</th><th>Open rate</th></tr></thead>
                <tbody>
                  {view.emails.map((send) => (
                    <tr key={send.id}>
                      <td>{send.subject}</td>
                      <td>{formatStamp(send.sentAt, { dateOnly: true })}</td>
                      <td>{formatNumber(send.reached)} of {formatNumber(send.recipientCount)}</td>
                      <td>{formatNumber(send.opened)}</td>
                      <td>{send.reached ? `${send.rate}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="admin-empty-inline">No broadcast emails have been sent yet.</p>}
        </div>
      </section>
    </div>
  );
}
