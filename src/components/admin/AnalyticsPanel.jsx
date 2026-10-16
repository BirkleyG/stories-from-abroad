import { useMemo, useState } from "react";
import { CONTENT_LABELS } from "../../lib/admin/schemas";
import {
  KINDS, KIND_COLUMNS, KIND_NOUN, KIND_PAGE, KIND_TITLES, OPEN_EVENT,
  aggregate, allPageStats, buildDays, buildInsights, buildItemRows, change, docsForDays, emailRows, fmtDecimal, fmtDuration, fmtInt, fmtPct,
  formatMetric, groupDimsByPrefix, pageStats, ratio, series, siteStats, topDims,
} from "../../lib/admin/analyticsModel";
import { BarStrip, DataTable, MetricGrid, RankList, TrendChart } from "./AnalyticsCharts";
import { KindItemDetail } from "./ItemPerformance";
import { EmptyState, StatTile, formatStamp, toDate } from "./ui";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "papers", label: "Stories" },
  { id: "photography", label: "Photography" },
  { id: "faces", label: "Faces" },
  { id: "travel", label: "Travel" },
  { id: "email", label: "Email" },
  { id: "insights", label: "Insights" },
];

const SOURCE_LABELS = { email: "Email links" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toneLabel(tone) {
  return { good: "Working", warn: "Needs attention", tip: "Opportunity", info: "Good to know" }[tone] || "Note";
}

function Panel({ title, description, children, className = "" }) {
  return (
    <section className={`admin-section ${className}`}>
      <header className="admin-section-header"><div><h3>{title}</h3>{description ? <p>{description}</p> : null}</div></header>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

function InsightList({ insights, onGo, limit }) {
  const shown = limit ? insights.slice(0, limit) : insights;
  if (!shown.length) return <p className="admin-empty-inline">No recommendations yet. They appear as readers generate data.</p>;
  return (
    <ul className="admin-insight-list">
      {shown.map((insight) => (
        <li key={insight.id} className={`tone-${insight.tone}`}>
          <small>{toneLabel(insight.tone)}</small>
          <strong>{insight.title}</strong>
          <p>{insight.body}</p>
          {insight.section && onGo && insight.section !== "overview" ? (
            <button type="button" className="admin-mini-button" onClick={() => onGo(insight.section)}>See the numbers</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function KindTab({ kind, rows, agg, docs, days, pageViewsSeries, insights, onGo }) {
  const [selectedKey, setSelectedKey] = useState("");
  const columns = KIND_COLUMNS[kind];
  const t = agg.totals || {};
  const page = pageStats(agg, KIND_PAGE[kind]);
  const sorted = useMemo(() => [...rows].sort((left, right) => right.score - left.score), [rows]);
  const best = sorted.filter((row) => row.opens > 0).slice(0, 6);
  const selected = rows.find((row) => row.key === selectedKey) || null;
  const rank = selected ? sorted.filter((row) => row.score > selected.score).length + 1 : 0;
  const dims = agg.dims || {};
  const timeColumn = kind === "papers" ? "absAvg" : "timeAvg";

  const pageTiles = [
    { value: fmtInt(page.views), label: "Visits to this page", hint: `${fmtInt(page.uniques)} unique visitors` },
    { value: fmtDuration(page.avgTime), label: "Avg time on page" },
    { value: fmtDuration(page.avgActive), label: "Avg active time" },
  ];
  let sectionTiles = [];
  if (kind === "papers") {
    const opens = Number(t.paper_open || 0);
    sectionTiles = [
      { value: fmtInt(opens), label: "Clicks into articles", hint: `${fmtInt(t.paper_open_u)} unique` },
      { value: fmtDuration(ratio(t.paper_abs_sec, opens)), label: "Avg time on paper page", hint: `${fmtDuration(ratio(t.paper_abs_act, opens))} active` },
      { value: fmtInt(t.paper_full_click), label: "Full-paper clicks", hint: `${fmtPct(ratio(t.paper_full_click, opens))} of opens` },
      { value: fmtInt(t.paper_text_dl), label: "Clean text downloads" },
      { value: fmtInt(t.paper_cite_copy), label: "Citations copied", hint: topDims(dims.paper_cite_copy, 1)[0] ? `Most: ${topDims(dims.paper_cite_copy, 1)[0].label.toUpperCase()}` : "" },
      { value: fmtInt(t.search_papers), label: "Searches", hint: `${fmtInt(topDims(dims.search_miss).filter((r) => r.label.startsWith("papers")).reduce((s, r) => s + r.value, 0))} found nothing` },
      { value: fmtInt(t.filter_papers), label: "Filters applied" },
    ];
  } else if (kind === "photography") {
    const opens = Number(t.shoot_open || 0);
    sectionTiles = [
      { value: fmtInt(opens), label: "Shoot clicks", hint: `${fmtInt(t.shoot_open_u)} unique` },
      { value: fmtDuration(ratio(t.shoot_sec, opens)), label: "Avg time per shoot", hint: `${fmtDuration(ratio(t.shoot_act, opens))} active` },
      { value: fmtInt(t.photo_view), label: "Photo views", hint: `${fmtDecimal(ratio(t.photo_view, opens))} per shoot opened` },
      { value: fmtInt(t.shoot_full), label: "Entire-shoot views", hint: `${fmtPct(ratio(t.shoot_full, opens))} reach the last frame` },
      { value: fmtInt(t.photo_zoom), label: "Photo zooms" },
      { value: fmtInt(t.photo_download), label: "Photo downloads" },
      { value: fmtInt(t.feat_click), label: "Featured slide clicks" },
      { value: fmtPct(ratio(t.shoot_pct, opens) === null ? null : ratio(t.shoot_pct, opens) / 100), label: "Avg depth through a shoot" },
    ];
  } else if (kind === "faces") {
    const starts = Number(t.faces_hero_start || 0);
    sectionTiles = [
      { value: fmtInt(starts), label: "Map scrolls started" },
      { value: fmtInt(t.faces_hero_full), label: "Full map scrolls", hint: `${fmtPct(ratio(t.faces_hero_full, starts))} of scrolls` },
      { value: fmtPct(ratio(t.faces_hero_pct, starts) === null ? null : ratio(t.faces_hero_pct, starts) / 100), label: "Avg map scroll", hint: "How far through the opening" },
      { value: fmtInt(t.pin_reveal), label: "Pins revealed on the map" },
      { value: fmtInt(t.pin_click), label: "Pins clicked", hint: `${fmtPct(ratio(t.pin_click, t.pin_reveal), 1)} of reveals` },
      { value: fmtInt(t.archive_open), label: "Archive opened", hint: `${fmtInt(t.archive_start)} scrolled it` },
      { value: fmtPct(ratio(t.archive_pct, t.archive_start) === null ? null : ratio(t.archive_pct, t.archive_start) / 100), label: "Avg archive scroll", hint: `${fmtInt(t.archive_full)} reached the end` },
      { value: fmtInt(t.story_open), label: "Stories clicked", hint: `${fmtInt(t.story_open_u)} unique` },
      { value: fmtDuration(ratio(t.story_sec, t.story_open)), label: "Avg time on a story", hint: `${fmtDuration(ratio(t.story_act, t.story_open))} active` },
      { value: fmtInt(t.story_full), label: "Stories scrolled fully", hint: `${fmtPct(ratio(t.story_full, t.story_open))} of stories opened` },
    ];
  } else {
    const opens = Number(t.dispatch_open || 0);
    sectionTiles = [
      { value: fmtPct(page.fullScroll), label: "Full page scrolls", hint: `${fmtInt(page.fullScrollCount)} visits reached the bottom` },
      { value: fmtInt(opens), label: "Dispatches clicked", hint: `${fmtInt(t.dispatch_open_u)} unique` },
      { value: fmtInt(t.filter_travel), label: "Views filtered", hint: topDims(dims.filter_travel, 1)[0] ? `Top: ${topDims(dims.filter_travel, 1)[0].label}` : "" },
      { value: fmtDuration(ratio(t.dispatch_sec, opens)), label: "Avg time on a dispatch", hint: `${fmtDuration(ratio(t.dispatch_act, opens))} active` },
      { value: fmtPct(ratio(t.dispatch_pct, opens) === null ? null : ratio(t.dispatch_pct, opens) / 100), label: "Avg read percent", hint: `${fmtInt(t.dispatch_full)} read to the end` },
      { value: fmtInt(t.dispatch_photo_click), label: "Photo clicks" },
      { value: fmtInt(t.dispatch_react), label: "Reactions", hint: topDims(Object.values(agg.idims || {}).reduce((acc, item) => { Object.entries(item.dispatch_react || {}).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; }); return acc; }, {}), 1)[0]?.label || "" },
      { value: fmtInt(t.dispatch_comment), label: "Comments" },
      { value: fmtInt(t.search_travel), label: "Searches" },
    ];
  }

  const funnel = kind === "faces" ? [
    { key: "a", label: "Started the map scroll", value: Number(t.faces_hero_start || 0) },
    { key: "b", label: "Revealed every pin", value: Number(t.faces_hero_full || 0) },
    { key: "c", label: "Clicked a pin", value: Number(t.pin_click || 0) },
    { key: "d", label: "Opened the archive", value: Number(t.archive_open || 0) },
    { key: "e", label: "Opened a story", value: Number(t.story_open || 0) },
    { key: "f", label: "Read a story to the end", value: Number(t.story_full || 0) },
  ] : kind === "papers" ? [
    { key: "a", label: "Visited the page", value: page.views },
    { key: "b", label: "Clicked into an article", value: Number(t.paper_open || 0) },
    { key: "c", label: "Scrolled to the end", value: Number(t.paper_read_full || 0) },
    { key: "d", label: "Opened the full paper", value: Number(t.paper_full_click || 0) },
    { key: "e", label: "Copied a citation", value: Number(t.paper_cite_copy || 0) },
  ] : kind === "photography" ? [
    { key: "a", label: "Visited the page", value: page.views },
    { key: "b", label: "Opened a shoot", value: Number(t.shoot_open || 0) },
    { key: "c", label: "Zoomed a photo", value: Number(t.photo_zoom || 0) },
    { key: "d", label: "Viewed an entire shoot", value: Number(t.shoot_full || 0) },
    { key: "e", label: "Downloaded a photo", value: Number(t.photo_download || 0) },
  ] : [
    { key: "a", label: "Visited the page", value: page.views },
    { key: "b", label: "Opened a dispatch", value: Number(t.dispatch_open || 0) },
    { key: "c", label: "Read one to the end", value: Number(t.dispatch_full || 0) },
    { key: "d", label: "Reacted", value: Number(t.dispatch_react || 0) },
    { key: "e", label: "Commented", value: Number(t.dispatch_comment || 0) },
  ];

  const opensSeries = series(docs, (doc) => doc?.totals?.[OPEN_EVENT[kind]]);
  const tableColumns = [
    {
      id: "title",
      label: KIND_NOUN[kind],
      sort: (row) => row.title.toLowerCase(),
      render: (row) => (<span><strong>{row.title}</strong>{row.removed ? <small className="admin-cell-sub">Not in admin any more</small> : null}</span>),
    },
    ...columns.map((column) => ({
      id: column.id,
      label: column.label,
      hint: column.tip,
      align: "right",
      sort: (row) => row.metrics[column.id],
      render: (row) => formatMetric(column, row.metrics[column.id]),
    })),
    { id: "score", label: "Score", hint: "Combined engagement score used to rank best performers.", align: "right", sort: (row) => row.score, render: (row) => fmtDecimal(row.score) },
  ];

  const searchRows = topDims(dims[`search_${kind === "papers" ? "papers" : kind === "travel" ? "travel" : "faces"}`], 10);
  const missRows = topDims(dims.search_miss, 30)
    .filter((row) => row.label.startsWith(kind === "papers" ? "papers:" : kind === "travel" ? "travel:" : "faces:"))
    .map((row) => ({ ...row, label: row.label.replace(/^[a-z]+: /, "") }))
    .slice(0, 8);
  const filterGroups = groupDimsByPrefix(dims[`filter_${kind === "papers" ? "papers" : kind === "travel" ? "travel" : "faces"}`]);
  const filterRows = kind === "travel"
    ? topDims(dims.filter_travel, 8)
    : Object.entries(filterGroups).flatMap(([group, groupRows]) => groupRows.slice(0, 4).map((row) => ({ key: `${group}-${row.key}`, label: row.label, sub: group, value: row.value }))).sort((a, b) => b.value - a.value).slice(0, 8);

  return (
    <div className="admin-analytics-tab">
      <div className="admin-stat-grid compact">
        {pageTiles.map((tile) => <StatTile key={tile.label} value={tile.value} label={tile.label} hint={tile.hint} />)}
      </div>
      <div className="admin-stat-grid compact">
        {sectionTiles.map((tile) => <StatTile key={tile.label} value={tile.value} label={tile.label} hint={tile.hint} />)}
      </div>

      <Panel title={`${KIND_TITLES[kind]} over time`} description={`${kind === "faces" ? "Stories opened" : "Opens"} each day against visits to the page.`}>
        <TrendChart labels={days} bars={opensSeries} line={pageViewsSeries} barLabel={kind === "faces" ? "Stories opened" : "Opens"} lineLabel="Page visits" height={200} />
      </Panel>

      <div className="admin-two-col">
        <Panel title="Best performers" description="Ranked by a combined engagement score (opens, time, completions and actions).">
          <RankList
            rows={best.map((row) => ({ key: row.key, label: row.title, sub: `${fmtInt(row.opens)} opens · ${fmtDuration(row.metrics[timeColumn])} avg time`, value: row.score }))}
            empty={`Once readers open ${KIND_NOUN[kind].toLowerCase()}s they rank here.`}
            format={(value) => fmtDecimal(value)}
          />
        </Panel>
        <Panel title="Reader journey" description="How many people make it to each step.">
          <RankList rows={funnel} empty="No data yet." />
        </Panel>
      </div>

      <Panel title={`Every ${KIND_NOUN[kind].toLowerCase()}`} description="Click a row for the full breakdown. Click a column heading to sort.">
        <DataTable
          columns={tableColumns}
          rows={rows}
          rowKey={(row) => row.key}
          defaultSort="score"
          onRowClick={(row) => setSelectedKey(row.key === selectedKey ? "" : row.key)}
          selectedKey={selectedKey}
          empty={`No ${KIND_NOUN[kind].toLowerCase()}s yet.`}
          pageSize={15}
        />
        {selected ? (
          <div className="admin-item-expanded">
            <h4 className="admin-subhead">{selected.title}</h4>
            <KindItemDetail kind={kind} row={selected} days={days} docs={docs} rank={selected.score > 0 ? rank : 0} total={sorted.length} />
          </div>
        ) : null}
      </Panel>

      <div className="admin-two-col">
        <Panel title="What people searched for">
          <RankList rows={searchRows} empty="No searches yet." />
        </Panel>
        <Panel title="Searches that found nothing" description="Content gaps worth writing about.">
          <RankList rows={missRows} empty="Nothing missing so far." />
        </Panel>
        <Panel title={kind === "travel" ? "Categories filtered to" : "Filters used"}>
          <RankList rows={filterRows} empty="No filters used yet." />
        </Panel>
        {kind === "faces" ? (
          <Panel title="Where readers go next" description="How story opens begin.">
            <RankList rows={topDims(dims.story_open, 8)} empty="No story opens yet." />
          </Panel>
        ) : null}
        {kind === "papers" ? (
          <Panel title="Citation styles copied">
            <RankList rows={topDims(dims.paper_cite_copy).map((row) => ({ ...row, label: row.label.toUpperCase() }))} empty="No citations copied yet." />
          </Panel>
        ) : null}
        {kind === "travel" ? (
          <Panel title="Reactions given">
            <RankList
              rows={topDims(Object.values(agg.idims || {}).reduce((acc, item) => { Object.entries(item.dispatch_react || {}).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; }); return acc; }, {}))}
              empty="No reactions yet."
            />
          </Panel>
        ) : null}
        {kind === "photography" ? (
          <Panel title="How shoots were opened">
            <RankList rows={topDims(dims.shoot_open, 8)} empty="No shoots opened yet." />
          </Panel>
        ) : null}
      </div>

      <Panel title={`Recommendations for ${KIND_TITLES[kind]}`}>
        <InsightList insights={insights.filter((insight) => insight.section === kind)} onGo={onGo} />
      </Panel>
    </div>
  );
}

function EmailTab({ emails, agg, rangeStart }) {
  const inRange = emails.filter((row) => {
    const date = toDate(row.sentAt);
    return date && date.getTime() >= rangeStart;
  });
  const reached = inRange.reduce((sum, row) => sum + row.reached, 0);
  const opened = inRange.reduce((sum, row) => sum + row.opened, 0);
  const landings = inRange.reduce((sum, row) => sum + row.landings, 0);
  const emailSource = agg.sources?.email || {};
  const withLandings = inRange.filter((row) => row.landings > 0);
  const sumSec = withLandings.reduce((sum, row) => sum + (row.avgTime || 0) * row.landings, 0);
  const sumAct = withLandings.reduce((sum, row) => sum + (row.avgActive || 0) * row.landings, 0);
  const sumActions = withLandings.reduce((sum, row) => sum + (row.actionsPerLanding || 0) * row.landings, 0);

  const columns = [
    { id: "subject", label: "Email", sort: (row) => row.subject, render: (row) => (<span><strong>{row.subject}</strong><small className="admin-cell-sub">{formatStamp(row.sentAt, { dateOnly: true })}</small></span>) },
    { id: "reached", label: "Reached", align: "right", sort: (row) => row.reached, render: (row) => `${fmtInt(row.reached)} of ${fmtInt(row.recipientCount)}` },
    { id: "opened", label: "Opened", align: "right", sort: (row) => row.opened, render: (row) => fmtInt(row.opened) },
    { id: "openRate", label: "Open rate", align: "right", sort: (row) => row.openRate, render: (row) => fmtPct(row.openRate) },
    { id: "landings", label: "Click-throughs", hint: "Visits to the site that started from a link in this email.", align: "right", sort: (row) => row.landings, render: (row) => fmtInt(row.landings) },
    { id: "ctr", label: "Click-through rate", hint: "Click-throughs divided by people reached.", align: "right", sort: (row) => row.ctr, render: (row) => fmtPct(row.ctr, 1) },
    { id: "cto", label: "Click-to-open", hint: "Click-throughs divided by opens.", align: "right", sort: (row) => row.clickToOpen, render: (row) => fmtPct(row.clickToOpen) },
    { id: "time", label: "Avg time after click", align: "right", sort: (row) => row.avgTime, render: (row) => fmtDuration(row.avgTime) },
    { id: "active", label: "Avg active time", align: "right", sort: (row) => row.avgActive, render: (row) => fmtDuration(row.avgActive) },
    { id: "pages", label: "Pages per visit", align: "right", sort: (row) => row.pagesPerLanding, render: (row) => fmtDecimal(row.pagesPerLanding) },
    { id: "actions", label: "Actions per visit", hint: "Opens, clicks, downloads, reactions and similar after landing.", align: "right", sort: (row) => row.actionsPerLanding, render: (row) => fmtDecimal(row.actionsPerLanding) },
  ];

  return (
    <div className="admin-analytics-tab">
      <div className="admin-stat-grid compact">
        <StatTile value={fmtInt(inRange.length)} label="Emails sent" hint={`${fmtInt(reached)} people reached`} />
        <StatTile value={fmtPct(ratio(opened, reached))} label="Open rate" hint="Image-based, so it undercounts" />
        <StatTile value={fmtInt(landings)} label="Click-throughs" hint={`${fmtPct(ratio(landings, reached), 1)} of people reached`} />
        <StatTile value={fmtPct(ratio(landings, opened))} label="Click-to-open rate" />
        <StatTile value={fmtDuration(ratio(sumSec, landings))} label="Avg time after click" hint={`${fmtDuration(ratio(sumAct, landings))} active`} />
        <StatTile value={fmtDecimal(ratio(sumActions, landings))} label="Actions per visit" hint="After clicking through" />
      </div>
      <Panel title="Every email" description="Click-throughs are visits that start from a link in the email. Engagement after the click follows the reader through the site. Click-through data starts with emails sent after this update.">
        <DataTable columns={columns} rows={emails} rowKey={(row) => row.id} defaultSort="subject" empty="No broadcast emails have been sent yet." pageSize={12} />
      </Panel>
      <div className="admin-two-col">
        <Panel title="Email visitors vs everyone" description="Total visits that arrived from email links in this period.">
          <MetricGrid
            columns={2}
            metrics={[
              { label: "Landings from email", value: fmtInt(emailSource.landings) },
              { label: "Page views after landing", value: fmtInt(emailSource.views) },
              { label: "Avg time per page view", value: fmtDuration(ratio(emailSource.sec, emailSource.views)) },
              { label: "Avg active per page view", value: fmtDuration(ratio(emailSource.act, emailSource.views)) },
              { label: "Actions taken", value: fmtInt(emailSource.actions) },
              { label: "Actions per landing", value: fmtDecimal(ratio(emailSource.actions, emailSource.landings)) },
            ]}
          />
        </Panel>
        <Panel title="Best click-through" description="Emails ranked by how many readers they sent to the site.">
          <RankList
            rows={[...emails].filter((row) => row.landings > 0).sort((a, b) => b.landings - a.landings).slice(0, 6).map((row) => ({ key: row.id, label: row.subject, sub: `${fmtPct(row.ctr, 1)} click-through`, value: row.landings }))}
            empty="No click-throughs recorded yet."
          />
        </Panel>
      </div>
    </div>
  );
}

export default function AnalyticsPanel({ analytics, subscribers, emailSends, lists, verifiedOnly, tab = "overview", onTabChange }) {
  const [rangeDays, setRangeDays] = useState(30);
  const activeTab = TABS.some((item) => item.id === tab) ? tab : "overview";
  const setTab = (id) => onTabChange?.(id);

  const view = useMemo(() => {
    const days = buildDays(rangeDays);
    const previousDays = buildDays(rangeDays, rangeDays);
    const byDay = new Map(analytics.map((doc) => [doc.id, doc]));
    const docs = docsForDays(byDay, days);
    const previousDocs = docsForDays(byDay, previousDays);
    const agg = aggregate(docs);
    const prevAgg = aggregate(previousDocs);
    const site = siteStats(agg);
    const prevSite = siteStats(prevAgg);

    const rows = {};
    KINDS.forEach((kind) => { rows[kind] = buildItemRows(kind, agg, lists?.[kind] || []); });
    const emails = emailRows(emailSends, agg);

    const verified = subscribers.filter(verifiedOnly);
    const cutoff = new Date(`${days[0]}T00:00:00Z`).getTime();
    const previousCutoff = new Date(`${previousDays[0]}T00:00:00Z`).getTime();
    const joinDay = (subscriber) => { const date = toDate(subscriber.createdAt); return date ? date.toISOString().slice(0, 10) : ""; };
    let running = verified.filter((subscriber) => { const date = toDate(subscriber.createdAt); return date && date.getTime() < cutoff; }).length;
    const joined = new Map();
    verified.forEach((subscriber) => { const key = joinDay(subscriber); if (key) joined.set(key, (joined.get(key) || 0) + 1); });
    const subscriberTotals = days.map((day) => { running += joined.get(day) || 0; return running; });
    const newInRange = days.reduce((sum, day) => sum + (joined.get(day) || 0), 0);
    const newInPrevious = verified.filter((subscriber) => { const date = toDate(subscriber.createdAt); return date && date.getTime() >= previousCutoff && date.getTime() < cutoff; }).length;

    const insights = buildInsights({ agg, prevAgg, days, docs, rows, emails, lists, subscribersNew: newInRange });
    const weekdayTotals = Array(7).fill(0);
    const weekdayDays = Array(7).fill(0);
    docs.forEach((doc) => { const weekday = new Date(`${doc.id}T00:00:00Z`).getUTCDay(); weekdayTotals[weekday] += Number(doc.views || 0); weekdayDays[weekday] += 1; });

    return {
      days, docs, agg, prevAgg, site, prevSite, rows, emails, insights, cutoff,
      views: series(docs, (doc) => doc.views),
      visitors: series(docs, (doc) => doc.uniques),
      subscriberTotals, newInRange, newInPrevious, totalSubscribers: verified.length,
      pages: allPageStats(agg),
      weekdays: WEEKDAYS.map((label, index) => ({ key: label, label, value: weekdayDays[index] ? Math.round(weekdayTotals[index] / weekdayDays[index]) : 0, title: `${label} average views` })),
      hours: Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: hour % 6 === 0 ? `${hour}h` : "", title: `${hour}:00`, value: Number(agg.hours?.[hour] || 0) })),
      hasData: analytics.length > 0 && site.views > 0,
    };
  }, [analytics, subscribers, emailSends, lists, rangeDays, verifiedOnly]);

  const { agg, site, prevSite } = view;
  const referrers = topDims(agg.referrers, 8).map((row) => ({ ...row, label: row.key === "direct" ? "Direct / unknown" : row.key.replace(/_/g, ".") }));
  const sources = Object.entries(agg.sources || {})
    .map(([key, value]) => ({ key, label: SOURCE_LABELS[key] || key, value: Number(value.landings || 0), sub: `${fmtDuration(ratio(value.act, value.views))} active per page view` }))
    .sort((a, b) => b.value - a.value);
  const devices = Object.entries(agg.devices || {}).map(([key, value]) => ({ key, label: key[0].toUpperCase() + key.slice(1), value: Number(value) })).sort((a, b) => b.value - a.value);
  const subscribeBy = topDims(agg.dims?.subscribe_ok, 6);
  const outbound = topDims(agg.dims?.outbound, 6);
  const subOpens = Number(agg.totals?.subscribe_open || 0);
  const subOk = Number(agg.totals?.subscribe_ok || 0);

  const pageColumns = [
    { id: "label", label: "Page", sort: (row) => row.label, render: (row) => row.label },
    { id: "views", label: "Visits", align: "right", sort: (row) => row.views, render: (row) => fmtInt(row.views) },
    { id: "uniques", label: "Unique", hint: "Visitors counted once per day.", align: "right", sort: (row) => row.uniques, render: (row) => fmtInt(row.uniques) },
    { id: "avgTime", label: "Avg time", hint: "Visible time on the page per visit.", align: "right", sort: (row) => row.avgTime, render: (row) => fmtDuration(row.avgTime) },
    { id: "avgActive", label: "Avg active time", hint: "Time with scrolling, clicks or typing.", align: "right", sort: (row) => row.avgActive, render: (row) => fmtDuration(row.avgActive) },
    { id: "scroll", label: "Avg scroll", align: "right", sort: (row) => row.avgScroll, render: (row) => fmtPct(row.avgScroll) },
    { id: "full", label: "Full scroll", hint: "Visits that reached 90% of the page.", align: "right", sort: (row) => row.fullScroll, render: (row) => fmtPct(row.fullScroll) },
    { id: "bounce", label: "Quick exits", hint: "Visits with under 10 seconds of active time.", align: "right", sort: (row) => row.bounce, render: (row) => fmtPct(row.bounce) },
  ];

  return (
    <div className="admin-analytics">
      <div className="admin-toolbar">
        <div className="admin-segmented" role="tablist" aria-label="Analytics section">
          {TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>
              {item.label}{item.id === "insights" && view.insights.length ? <span className="admin-tab-badge">{view.insights.length}</span> : null}
            </button>
          ))}
        </div>
        <div className="admin-segmented small" role="group" aria-label="Date range">
          {RANGES.map((range) => (
            <button key={range.days} type="button" aria-pressed={rangeDays === range.days} className={rangeDays === range.days ? "is-active" : ""} onClick={() => setRangeDays(range.days)}>{range.label}</button>
          ))}
        </div>
      </div>
      <small className="admin-field-hint">Dates are in UTC. Your own visits (from any browser that has opened /admin) and localhost are not counted. No cookies, IP addresses or personal details are stored.</small>

      {!view.hasData ? (
        <EmptyState title="No visits recorded in this period">
          Engagement appears here a minute after the first real visit. If it stays empty after the site is live, deploy the Cloud Functions (<code>firebase deploy --only functions,firestore:rules</code>) and visit a page from a browser that has never opened /admin.
        </EmptyState>
      ) : null}

      {activeTab === "overview" ? (
        <div className="admin-analytics-tab">
          <div className="admin-stat-grid compact">
            <StatTile value={fmtInt(site.views)} label="Page views" hint={change(site.views, prevSite.views)} />
            <StatTile value={fmtInt(site.uniques)} label="Visitors (daily unique)" hint={change(site.uniques, prevSite.uniques)} />
            <StatTile value={fmtInt(site.sessions)} label="Sessions" hint={`${fmtDecimal(site.pagesPerSession)} pages per session`} />
            <StatTile value={fmtDuration(site.avgTime)} label="Avg time per page" hint={`${fmtDuration(site.avgActive)} active`} />
            <StatTile value={fmtPct(site.bounce)} label="Quick exits" hint="Under 10s of active time" />
            <StatTile value={fmtPct(site.returningShare)} label="Returning visitors" hint={`${fmtInt(site.newVisitors)} first-time visitors`} />
            <StatTile value={fmtInt(view.totalSubscribers)} label="Verified subscribers" hint={`${view.newInRange >= 0 ? "+" : ""}${view.newInRange} in this period`} />
            <StatTile value={fmtPct(site.mobileShare)} label="Mobile share" />
          </div>

          <Panel title="Traffic" description="Page views and daily visitors on the public site.">
            <TrendChart labels={view.days} bars={view.views} line={view.visitors} barLabel="Page views" lineLabel="Visitors" />
          </Panel>

          <Panel title="Every page" description="Visits, time and scroll per page. Click a heading to sort.">
            <DataTable columns={pageColumns} rows={view.pages} rowKey={(row) => row.path} defaultSort="views" empty="No page views yet." />
          </Panel>

          <div className="admin-two-col">
            <Panel title="Where visitors come from" description="Referring sites."><RankList rows={referrers} empty="No referrers yet." /></Panel>
            <Panel title="Campaign and link sources" description="Visits that arrived through tagged links, such as emails."><RankList rows={sources} empty="No tagged visits yet." /></Panel>
            <Panel title="Devices"><RankList rows={devices} empty="No device data yet." /></Panel>
            <Panel title="Subscribe funnel" description="People who opened a subscribe prompt, and those who completed one.">
              <MetricGrid columns={3} metrics={[
                { label: "Prompts opened", value: fmtInt(subOpens) },
                { label: "Completed", value: fmtInt(subOk) },
                { label: "Conversion", value: fmtPct(ratio(subOk, subOpens)) },
              ]} />
              <h4 className="admin-subhead">Where subscribers signed up</h4>
              <RankList rows={subscribeBy} empty="No sign-ups tracked yet." />
            </Panel>
            <Panel title="Busiest hours" description="Visits by hour of the day in the reader's own timezone."><BarStrip items={view.hours} /></Panel>
            <Panel title="Busiest days" description="Average views by day of the week."><BarStrip items={view.weekdays} /></Panel>
            <Panel title="Subscribers over time" description="Verified subscriber count at the end of each day.">
              <TrendChart labels={view.days} line={view.subscriberTotals} lineLabel="Verified subscribers" area height={180} />
            </Panel>
            <Panel title="Links readers leave through" description="Outbound clicks by destination."><RankList rows={outbound} empty="No outbound clicks yet." /></Panel>
          </div>

          <Panel title="Top recommendations" description="The most useful things to act on right now.">
            <InsightList insights={view.insights.filter((insight) => insight.tone !== "info").slice(0, 4)} onGo={setTab} />
            <button type="button" className="admin-mini-button" onClick={() => setTab("insights")}>See all recommendations</button>
          </Panel>
        </div>
      ) : null}

      {KINDS.includes(activeTab) ? (
        <KindTab
          key={activeTab}
          kind={activeTab}
          rows={view.rows[activeTab]}
          agg={agg}
          docs={view.docs}
          days={view.days}
          pageViewsSeries={series(view.docs, (doc) => doc?.pages?.[KIND_PAGE[activeTab].replace(/[./]/g, "_")]?.pg_view)}
          insights={view.insights}
          onGo={setTab}
        />
      ) : null}

      {activeTab === "email" ? <EmailTab emails={view.emails} agg={agg} rangeStart={view.cutoff} /> : null}

      {activeTab === "insights" ? (
        <div className="admin-analytics-tab">
          <Panel title="Strategic recommendations" description="Generated from the last period of reader behaviour. They get sharper as more data arrives.">
            <InsightList insights={view.insights} onGo={setTab} />
          </Panel>
          <Panel title="Best performers across the site" description="Top item of each kind by engagement score.">
            <div className="admin-two-col">
              {KINDS.map((kind) => {
                const top = [...view.rows[kind]].filter((row) => row.opens > 0).sort((a, b) => b.score - a.score).slice(0, 3);
                return (
                  <div key={kind}>
                    <h4 className="admin-subhead">{CONTENT_LABELS[kind] || KIND_TITLES[kind]}</h4>
                    <RankList rows={top.map((row) => ({ key: row.key, label: row.title, sub: `${fmtInt(row.opens)} opens`, value: row.score }))} empty="Nothing opened yet." format={(value) => fmtDecimal(value)} />
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
