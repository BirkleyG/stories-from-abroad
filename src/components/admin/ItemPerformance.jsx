import { useMemo, useState } from "react";
import {
  KIND_COLUMNS, OPEN_EVENT, aggregate, buildDays, buildItemRows, docsForDays, formatMetric, fmtInt, itemDaySeries, itemKeyFor, prettyDetail, topDims,
} from "../../lib/admin/analyticsModel";
import { MetricGrid, RankList, Sparkline } from "./AnalyticsCharts";
import { DataTable } from "./AnalyticsCharts";

const SOURCE_LABELS = {
  card: "Clicked a card", list: "Archive list", featured: "Featured slide", email: "Email link", link: "Shared / direct link",
  quote: "Quote ticker", pin: "Map pin", search: "Search", archive: "Archive", nav: "Site navigation", archive_view: "Archive",
  map: "Map", image: "Featured image", button: "Featured button", about: "About page", pdf: "Download PDF", publication: "Publication link",
};

function photoTitleLookup(item) {
  const lookup = {};
  const pools = [item?.photos, item?.allPhotos, item?.publishedRecord?.allPhotos, item?.publishedRecord?.photos];
  pools.forEach((pool) => {
    (Array.isArray(pool) ? pool : []).forEach((photo, index) => {
      const id = String(photo?.id || `p${index + 1}`).toLowerCase();
      if (!lookup[id]) lookup[id] = photo?.title || photo?.caption || photo?.alt || `Frame ${String(index + 1).padStart(2, "0")}`;
    });
  });
  return lookup;
}

function dimRows(map, limit = 8) {
  return topDims(map, limit).map((row) => ({ ...row, label: SOURCE_LABELS[row.key] || SOURCE_LABELS[row.label] || row.label }));
}

// Full stats for one item. Used in the Analytics tab and under each item in the content tabs.
export function KindItemDetail({ kind, row, days, docs, rank, total }) {
  const columns = KIND_COLUMNS[kind];
  const metrics = columns.map((column) => ({ label: column.label, value: formatMetric(column, row.metrics[column.id]), hint: column.tip }));
  const trend = itemDaySeries(docs, row.key, OPEN_EVENT[kind]);
  const opens = trend.reduce((sum, value) => sum + value, 0);
  const idims = row.idims || {};
  const sources = dimRows(idims[OPEN_EVENT[kind]]);
  const photoLookup = kind === "photography" ? photoTitleLookup(row.item) : {};

  const photoRows = kind === "photography"
    ? Object.keys({ ...(idims.photo_view || {}), ...(idims.photo_zoom || {}), ...(idims.photo_download || {}) }).map((id) => ({
      id,
      title: photoLookup[id] || `Photo ${id}`,
      views: Number(idims.photo_view?.[id] || 0),
      zooms: Number(idims.photo_zoom?.[id] || 0),
      downloads: Number(idims.photo_download?.[id] || 0),
    }))
    : [];

  return (
    <div className="admin-item-detail">
      <div className="admin-item-detail-head">
        <div>
          {rank ? <small className="admin-field-hint">Ranks #{rank} of {total} by engagement in this period.</small> : null}
        </div>
        <div className="admin-item-trend">
          <Sparkline values={trend} labels={days} label="Opens per day" />
          <small>{fmtInt(opens)} opens over {days.length} days</small>
        </div>
      </div>
      <MetricGrid metrics={metrics} columns={4} />
      <div className="admin-two-col admin-item-breakdowns">
        <div>
          <h4 className="admin-subhead">How readers opened it</h4>
          <RankList rows={sources} empty="No opens recorded yet." />
        </div>
        {kind === "papers" ? (
          <div>
            <h4 className="admin-subhead">Citation styles copied</h4>
            <RankList rows={dimRows(idims.paper_cite_copy).map((r) => ({ ...r, label: r.label.toUpperCase() }))} empty="No citations copied yet." />
            <h4 className="admin-subhead">Full paper opened via</h4>
            <RankList rows={dimRows(idims.paper_full_click)} empty="No full-paper clicks yet." />
          </div>
        ) : null}
        {kind === "travel" ? (
          <div>
            <h4 className="admin-subhead">Reactions</h4>
            <RankList rows={topDims(idims.dispatch_react).map((r) => ({ ...r, label: r.label }))} empty="No reactions yet." />
            <h4 className="admin-subhead">Photos clicked (by position)</h4>
            <RankList rows={topDims(idims.dispatch_photo_click).map((r) => ({ ...r, label: `Photo ${r.label}` }))} empty="No photo clicks yet." />
          </div>
        ) : null}
        {kind === "faces" ? (
          <div>
            <h4 className="admin-subhead">Discovery on the map</h4>
            <RankList
              rows={[
                { key: "reveal", label: "Pin revealed", value: Number(row.it.pin_reveal || 0) },
                { key: "click", label: "Pin clicked", value: Number(row.it.pin_click || 0) },
                { key: "archive", label: "Seen in archive", value: Number(row.it.archive_view || 0) },
                { key: "open", label: "Story opened", value: Number(row.it.story_open || 0) },
              ]}
              empty=""
            />
          </div>
        ) : null}
      </div>
      {kind === "photography" ? (
        <div className="admin-item-photos">
          <h4 className="admin-subhead">Photo by photo</h4>
          <DataTable
            columns={[
              { id: "title", label: "Photo", render: (r) => r.title, sort: (r) => r.title },
              { id: "views", label: "Views", align: "right", render: (r) => fmtInt(r.views), sort: (r) => r.views },
              { id: "zooms", label: "Zooms", align: "right", render: (r) => fmtInt(r.zooms), sort: (r) => r.zooms },
              { id: "downloads", label: "Downloads", align: "right", render: (r) => fmtInt(r.downloads), sort: (r) => r.downloads },
            ]}
            rows={photoRows}
            rowKey={(r) => r.id}
            defaultSort="views"
            empty="No individual photo views recorded yet."
            pageSize={8}
          />
        </div>
      ) : null}
    </div>
  );
}

const RANGE_OPTIONS = [{ days: 7, label: "7d" }, { days: 30, label: "30d" }, { days: 90, label: "90d" }];

// Compact performance card shown under an item in the Papers / Photography / Faces / Travel tabs.
export default function ItemPerformance({ kind, item, analytics, onOpenAnalytics }) {
  const [rangeDays, setRangeDays] = useState(30);
  const view = useMemo(() => {
    const days = buildDays(rangeDays);
    const byDay = new Map(analytics.map((doc) => [doc.id, doc]));
    const docs = docsForDays(byDay, days);
    const agg = aggregate(docs);
    const key = itemKeyFor(kind, item);
    const rows = buildItemRows(kind, agg, key ? [item] : []);
    const row = rows.find((candidate) => candidate.key === key) || null;
    const allRows = buildItemRows(kind, agg, []).sort((a, b) => b.score - a.score);
    const rank = row && row.score > 0 ? allRows.filter((other) => other.score > row.score).length + 1 : 0;
    return { days, docs, row, rank, total: allRows.length || 1, hasData: analytics.length > 0, key };
  }, [analytics, kind, item, rangeDays]);

  if (!view.key) return null;

  return (
    <section className="admin-section admin-item-performance">
      <header className="admin-section-header">
        <div>
          <h3>Performance</h3>
          <p>How readers engage with this {kind === "photography" ? "shoot" : kind === "faces" ? "profile" : kind === "travel" ? "dispatch" : "paper"}. Dates are UTC; your own visits are not counted.</p>
        </div>
        <div className="admin-actionbar-buttons">
          <div className="admin-segmented small" role="tablist" aria-label="Date range">
            {RANGE_OPTIONS.map((option) => (
              <button key={option.days} type="button" className={rangeDays === option.days ? "is-active" : ""} onClick={() => setRangeDays(option.days)}>{option.label}</button>
            ))}
          </div>
          {onOpenAnalytics ? <button type="button" className="admin-mini-button" onClick={() => onOpenAnalytics(kind)}>All in Analytics</button> : null}
        </div>
      </header>
      <div className="admin-section-body">
        {view.row && view.row.opens > 0 ? (
          <KindItemDetail kind={kind} row={view.row} days={view.days} docs={view.docs} rank={view.rank} total={view.total} />
        ) : (
          <p className="admin-empty-inline">
            {view.hasData
              ? "No engagement recorded for this item in the selected period yet. It appears here as soon as readers open it."
              : "Engagement appears here once readers start opening it."}
          </p>
        )}
      </div>
    </section>
  );
}
