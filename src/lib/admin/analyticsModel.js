// Turns the daily rollups in `analytics_daily` into the numbers the admin shows.
// Event names mirror functions/src/analyticsModel.js and public/scripts/sfa-track.js.

export const KINDS = ["papers", "photography", "faces", "travel"];

export const PAGE_LABELS = {
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

export const KIND_PAGE = {
  papers: "/selected-papers/",
  photography: "/photography/",
  faces: "/faces-of-the-world/",
  travel: "/travel-stories/",
};

export const KIND_NOUN = { papers: "Paper", photography: "Shoot", faces: "Profile", travel: "Dispatch" };
export const KIND_TITLES = { papers: "Stories & Papers", photography: "Photography", faces: "Faces of the World", travel: "Travel Dispatches" };

const num = (value) => Number(value) || 0;

export function pageKey(path) {
  return String(path).replace(/[.\/\[\]*`~\s]/g, "_");
}

export function pathFromKey(key) {
  return key.replace(/_/g, "/");
}

export function slugify(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

export function itemKeyFor(kind, item) {
  const slug = slugify(item?.publishedRecord?.slug || item?.slug || item?.id || "");
  return slug ? `${kind}:${slug}` : "";
}

export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

export function buildDays(count, endOffset = 0) {
  const days = [];
  const today = new Date();
  for (let offset = count - 1 + endOffset; offset >= endOffset; offset -= 1) {
    days.push(dayKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset))));
  }
  return days;
}

function deepSum(into, from) {
  Object.entries(from || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!into[key] || typeof into[key] !== "object") into[key] = {};
      deepSum(into[key], value);
    } else if (typeof value === "number") {
      into[key] = (into[key] || 0) + value;
    }
  });
}

// Sum a list of daily docs into one object with the same shape.
export function aggregate(docs) {
  const total = {};
  docs.forEach((doc) => {
    const { id, date, ...rest } = doc || {};
    deepSum(total, rest);
  });
  return total;
}

export function docsForDays(byDay, days) {
  return days.map((day) => byDay.get(day) || { id: day });
}

// ---------- formatting ----------
export function fmtInt(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(num(value)));
}

export function fmtPct(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function fmtDecimal(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

export function ratio(a, b) {
  return b ? num(a) / num(b) : null;
}

export function change(current, previous) {
  if (!previous) return current ? "New" : "";
  const delta = Math.round(((current - previous) / previous) * 100);
  return `${delta >= 0 ? "+" : ""}${delta}% vs previous period`;
}

export function prettyDetail(value) {
  return String(value).replace(/_/g, " ");
}

// ---------- pages ----------
export function pageStats(agg, path) {
  const page = agg?.pages?.[pageKey(path)] || {};
  const views = num(page.pg_view);
  return {
    path,
    label: PAGE_LABELS[path] || path,
    views,
    uniques: num(page.pg_view_u),
    entries: num(agg?.entries?.[pageKey(path)]),
    avgTime: ratio(page.pg_sec, views),
    avgActive: ratio(page.pg_act, views),
    totalTime: num(page.pg_sec),
    totalActive: num(page.pg_act),
    avgScroll: ratio(page.pg_scroll, views) === null ? null : ratio(page.pg_scroll, views) / 100,
    fullScroll: ratio(page.pg_full, views),
    fullScrollCount: num(page.pg_full),
    bounce: views ? Math.max(0, 1 - num(page.pg_t10) / views) : null,
    engaged30: ratio(page.pg_t30, views),
    engaged60: ratio(page.pg_t60, views),
  };
}

export function allPageStats(agg) {
  return Object.keys(agg?.pages || {})
    .map((key) => pageStats(agg, pathFromKey(key)))
    .sort((left, right) => right.views - left.views);
}

export function siteStats(agg) {
  const views = num(agg?.views);
  const sessions = num(agg?.sessions);
  const pg = Object.values(agg?.pages || {});
  const t10 = pg.reduce((sum, page) => sum + num(page.pg_t10), 0);
  return {
    views,
    uniques: num(agg?.uniques),
    sessions,
    pagesPerSession: ratio(agg?.sessPages, sessions),
    avgTime: ratio(agg?.sec, views),
    avgActive: ratio(agg?.act, views),
    totalTime: num(agg?.sec),
    totalActive: num(agg?.act),
    bounce: views ? Math.max(0, 1 - t10 / views) : null,
    newVisitors: num(agg?.newVisitors),
    returning: num(agg?.returning),
    returningShare: ratio(agg?.returning, num(agg?.returning) + num(agg?.newVisitors)),
    mobileShare: ratio(agg?.devices?.mobile, Object.values(agg?.devices || {}).reduce((sum, value) => sum + num(value), 0)),
  };
}

// ---------- per-kind metric columns ----------
// get(it, ctx) returns a number (or null); fmt picks how it prints.
const FORMATTERS = { int: fmtInt, pct: (v) => fmtPct(v), pct1: (v) => fmtPct(v, 1), dur: fmtDuration, dec: (v) => fmtDecimal(v) };

export function formatMetric(column, value) {
  if (value === null || value === undefined) return "—";
  return (FORMATTERS[column.fmt] || fmtInt)(value);
}

const c = (id, label, fmt, get, tip) => ({ id, label, fmt, get, tip });

export const KIND_COLUMNS = {
  papers: [
    c("opens", "Clicks into article", "int", (it) => num(it.paper_open), "Times the article overlay was opened."),
    c("unique", "Unique readers", "int", (it) => num(it.paper_open_u), "Distinct browsers per day who opened it."),
    c("absAvg", "Avg abstract time", "dur", (it) => ratio(it.paper_abs_sec, it.paper_open), "Visible time the article overlay stayed open, per open."),
    c("absActive", "Avg active time", "dur", (it) => ratio(it.paper_abs_act, it.paper_open), "Time with scrolling, clicks or keys, per open."),
    c("depth", "Avg read depth", "pct", (it) => (ratio(it.paper_read_pct, it.paper_open) ?? null) === null ? null : ratio(it.paper_read_pct, it.paper_open) / 100, "How far down the overlay people scrolled."),
    c("readEnd", "Scrolled to end", "pct", (it) => ratio(it.paper_read_full, it.paper_open), "Share of opens that reached the bottom."),
    c("fullClicks", "Full-paper clicks", "int", (it) => num(it.paper_full_click), "Clicks on Download PDF or the publication link."),
    c("fullRate", "Full-paper click rate", "pct", (it) => ratio(it.paper_full_click, it.paper_open), "Full-paper clicks divided by opens."),
    c("fullTime", "Avg time on full paper", "dur", (it) => ratio(it.paper_full_sec, it.paper_full_click), "Time away from the site after the click; the best available estimate of reading the full paper."),
    c("text", "Clean-text downloads", "int", (it) => num(it.paper_text_dl)),
    c("cite", "Citations copied", "int", (it) => num(it.paper_cite_copy)),
  ],
  photography: [
    c("opens", "Shoot clicks", "int", (it) => num(it.shoot_open), "Times the shoot was opened."),
    c("unique", "Unique viewers", "int", (it) => num(it.shoot_open_u)),
    c("timeAvg", "Avg time in shoot", "dur", (it) => ratio(it.shoot_sec, it.shoot_open)),
    c("activeAvg", "Avg active time", "dur", (it) => ratio(it.shoot_act, it.shoot_open)),
    c("depth", "Avg depth", "pct", (it) => (ratio(it.shoot_pct, it.shoot_open) ?? null) === null ? null : ratio(it.shoot_pct, it.shoot_open) / 100, "How far through the frames people got."),
    c("complete", "Entire-shoot views", "int", (it) => num(it.shoot_full), "Visitors who reached the final frame."),
    c("completeRate", "Completion rate", "pct", (it) => ratio(it.shoot_full, it.shoot_open)),
    c("photoViews", "Photo views", "int", (it) => num(it.photo_view), "Individual frames reached."),
    c("zooms", "Photo zooms", "int", (it) => num(it.photo_zoom)),
    c("downloads", "Photo downloads", "int", (it) => num(it.photo_download)),
    c("feat", "Featured clicks", "int", (it) => num(it.feat_click)),
  ],
  faces: [
    c("opens", "Stories clicked", "int", (it) => num(it.story_open), "Times the profile was opened."),
    c("unique", "Unique readers", "int", (it) => num(it.story_open_u)),
    c("timeAvg", "Avg time on story", "dur", (it) => ratio(it.story_sec, it.story_open)),
    c("activeAvg", "Avg active time", "dur", (it) => ratio(it.story_act, it.story_open)),
    c("depth", "Avg scroll depth", "pct", (it) => (ratio(it.story_pct, it.story_open) ?? null) === null ? null : ratio(it.story_pct, it.story_open) / 100),
    c("full", "Full scrolls", "int", (it) => num(it.story_full), "Readers who reached the end of the profile."),
    c("fullRate", "Full-scroll rate", "pct", (it) => ratio(it.story_full, it.story_open)),
    c("reveals", "Pin revealed", "int", (it) => num(it.pin_reveal), "Times the pin appeared on the map."),
    c("pinClicks", "Pin clicked", "int", (it) => num(it.pin_click)),
    c("pinRate", "Pin click rate", "pct", (it) => ratio(it.pin_click, it.pin_reveal)),
    c("archive", "Archive views", "int", (it) => num(it.archive_view), "Times its portrait slid by in the archive."),
    c("zoom", "Portrait zooms", "int", (it) => num(it.story_photo_zoom)),
  ],
  travel: [
    c("opens", "Dispatches clicked", "int", (it) => num(it.dispatch_open)),
    c("unique", "Unique readers", "int", (it) => num(it.dispatch_open_u)),
    c("timeAvg", "Avg time reading", "dur", (it) => ratio(it.dispatch_sec, it.dispatch_open)),
    c("activeAvg", "Avg active time", "dur", (it) => ratio(it.dispatch_act, it.dispatch_open)),
    c("readPct", "Avg read percent", "pct", (it) => (ratio(it.dispatch_pct, it.dispatch_open) ?? null) === null ? null : ratio(it.dispatch_pct, it.dispatch_open) / 100),
    c("full", "Read to the end", "int", (it) => num(it.dispatch_full)),
    c("fullRate", "Finish rate", "pct", (it) => ratio(it.dispatch_full, it.dispatch_open)),
    c("photos", "Photo clicks", "int", (it) => num(it.dispatch_photo_click)),
    c("reactions", "Reactions", "int", (it) => num(it.dispatch_react)),
    c("comments", "Comments", "int", (it) => num(it.dispatch_comment)),
    c("quotes", "Quote-ticker clicks", "int", (it) => num(it.feat_click)),
  ],
};

export const OPEN_EVENT = { papers: "paper_open", photography: "shoot_open", faces: "story_open", travel: "dispatch_open" };

// A single comparable number per item, used for "best performers".
export function engagementScore(kind, it = {}) {
  switch (kind) {
    case "papers":
      return num(it.paper_open) + 3 * num(it.paper_full_click) + 2 * num(it.paper_cite_copy) + 2 * num(it.paper_text_dl) + num(it.paper_abs_act) / 30 + num(it.paper_read_full);
    case "photography":
      return num(it.shoot_open) + 3 * num(it.shoot_full) + 3 * num(it.photo_download) + num(it.photo_zoom) + num(it.photo_view) / 10 + num(it.shoot_act) / 60;
    case "faces":
      return num(it.story_open) + 3 * num(it.story_full) + num(it.pin_click) + num(it.story_act) / 30 + num(it.story_photo_zoom);
    case "travel":
      return num(it.dispatch_open) + 3 * num(it.dispatch_full) + 2 * num(it.dispatch_react) + 4 * num(it.dispatch_comment) + num(it.dispatch_photo_click) + num(it.dispatch_act) / 30;
    default:
      return 0;
  }
}

export function itemTitleOf(item) {
  return item?.title || item?.profileName || item?.locationName || "";
}

// Every admin item for a kind plus anything seen in analytics that is no longer in the admin.
export function buildItemRows(kind, agg, list) {
  const rows = new Map();
  (list || []).forEach((item) => {
    const key = itemKeyFor(kind, item);
    if (!key) return;
    rows.set(key, { key, kind, title: itemTitleOf(item) || key.split(":")[1], item, removed: false });
  });
  Object.keys(agg?.items || {}).forEach((key) => {
    if (!key.startsWith(`${kind}:`) || rows.has(key)) return;
    rows.set(key, { key, kind, title: key.split(":")[1].replace(/-/g, " "), item: null, removed: true });
  });
  return [...rows.values()].map((row) => {
    const it = agg?.items?.[row.key] || {};
    const metrics = {};
    KIND_COLUMNS[kind].forEach((column) => { metrics[column.id] = column.get(it); });
    return { ...row, it, idims: agg?.idims?.[row.key] || {}, metrics, score: engagementScore(kind, it), opens: num(it[OPEN_EVENT[kind]]) };
  });
}

export function topDims(dimMap, limit = 10) {
  return Object.entries(dimMap || {})
    .map(([key, value]) => ({ key, label: prettyDetail(key), value: num(value) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

// Group a "dim" map like { "category__x": n } where details look like "category: essay" into { category: [...] }.
export function groupDimsByPrefix(dimMap) {
  const groups = {};
  Object.entries(dimMap || {}).forEach(([key, value]) => {
    const text = prettyDetail(key);
    const split = text.indexOf(":");
    const group = split > 0 ? text.slice(0, split).trim() : "other";
    const label = split > 0 ? text.slice(split + 1).trim() : text;
    (groups[group] = groups[group] || []).push({ key, label, value: num(value) });
  });
  Object.values(groups).forEach((rows) => rows.sort((left, right) => right.value - left.value));
  return groups;
}

// Series of one numeric getter over a list of day docs.
export function series(docs, getter) {
  return docs.map((doc) => num(getter(doc)));
}

export function itemDaySeries(docs, itemKey, event) {
  return series(docs, (doc) => doc?.items?.[itemKey]?.[event]);
}

// ---------- email ----------
export function emailRows(emailSends, agg) {
  return (emailSends || [])
    .filter((send) => !send.test)
    .map((send) => {
      const camp = agg?.camps?.[send.id] || {};
      const reached = num(send.succeeded);
      const opened = num(send.uniqueOpens);
      const landings = num(camp.landings);
      return {
        ...send,
        reached,
        opened,
        openRate: ratio(opened, reached),
        landings,
        ctr: ratio(landings, reached),
        clickToOpen: ratio(landings, opened),
        views: num(camp.views),
        pagesPerLanding: ratio(camp.views, landings),
        avgTime: ratio(camp.sec, landings),
        avgActive: ratio(camp.act, landings),
        actionsPerLanding: ratio(camp.actions, landings),
      };
    });
}

// ---------- recommendations ----------
const MIN_SAMPLE = 5;

export function buildInsights({ agg, prevAgg, days, docs, rows, emails, lists, subscribersNew }) {
  const insights = [];
  const site = siteStats(agg);
  const prevSite = siteStats(prevAgg || {});
  const add = (tone, title, body, section) => insights.push({ id: `${insights.length}-${title}`, tone, title, body, section });

  if (!site.views) {
    add("info", "No visits recorded yet", "Once the updated site and Cloud Functions are deployed, engagement data will start to appear here within a minute of the first visit.", "overview");
    return insights;
  }

  // Traffic momentum
  if (prevSite.views >= MIN_SAMPLE) {
    const delta = (site.views - prevSite.views) / prevSite.views;
    if (delta >= 0.25) add("good", "Traffic is climbing", `Page views are up ${Math.round(delta * 100)}% on the previous period. Whatever you published or shared recently is working; repeat the format.`, "overview");
    else if (delta <= -0.25) add("warn", "Traffic dipped", `Page views are down ${Math.round(Math.abs(delta) * 100)}% on the previous period. A new email or post is the quickest way to pull readers back.`, "overview");
  }

  // Best day of the week and best hour
  const byWeekday = Array(7).fill(0);
  const counts = Array(7).fill(0);
  docs.forEach((doc) => {
    if (!doc?.id) return;
    const weekday = new Date(`${doc.id}T00:00:00Z`).getUTCDay();
    byWeekday[weekday] += num(doc.views);
    counts[weekday] += 1;
  });
  const avgWeekday = byWeekday.map((total, index) => (counts[index] ? total / counts[index] : 0));
  const bestWeekday = avgWeekday.indexOf(Math.max(...avgWeekday));
  if (site.views >= 30 && avgWeekday[bestWeekday] > 0) {
    const names = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
    add("tip", `${names[bestWeekday]} are your strongest day`, `Visits average ${Math.round(avgWeekday[bestWeekday])} a day on ${names[bestWeekday].toLowerCase()}. Schedule emails and new posts to land just before then.`, "overview");
  }
  const hours = Object.entries(agg.hours || {}).map(([hour, value]) => ({ hour: Number(hour), value: num(value) })).sort((left, right) => right.value - left.value);
  if (hours.length && site.views >= 30) {
    const top = hours[0].hour;
    const label = (hour) => `${((hour + 11) % 12) + 1}${hour < 12 ? "am" : "pm"}`;
    add("tip", `Readers arrive around ${label(top)}`, `The busiest hour of the day (in your readers' own local time) is ${label(top)}. Sending email shortly before then tends to catch the peak.`, "overview");
  }

  // Devices
  if (site.mobileShare !== null && site.views >= 30) {
    if (site.mobileShare >= 0.6) add("tip", "Most readers are on phones", `${fmtPct(site.mobileShare)} of visits are on mobile. Check the shoot, atlas and archive pages on a phone before each launch.`, "overview");
    else if (site.mobileShare <= 0.25) add("info", "Mostly desktop readers", `Only ${fmtPct(site.mobileShare)} of visits are on mobile, so wide-screen layouts like the photography and map pages matter most.`, "overview");
  }

  // Loyalty
  if (site.returningShare !== null && site.newVisitors + site.returning >= 20) {
    if (site.returningShare < 0.15) add("tip", "Few readers come back", `Only ${fmtPct(site.returningShare)} of daily visitors have been here before. Ending each piece with a subscribe prompt and a "next story" link usually lifts this.`, "overview");
    else if (site.returningShare > 0.4) add("good", "Strong returning audience", `${fmtPct(site.returningShare)} of daily visitors are returning readers. They are your best candidates for subscribing, sharing and commenting.`, "overview");
  }

  // Pages: bounce and depth
  const pages = allPageStats(agg).filter((page) => page.views >= MIN_SAMPLE && ["/", "/selected-papers/", "/photography/", "/travel-stories/", "/faces-of-the-world/"].includes(page.path));
  const bouncy = pages.filter((page) => page.bounce !== null && page.bounce > 0.7).sort((left, right) => right.views - left.views)[0];
  if (bouncy) add("warn", `Many visitors leave ${bouncy.label} quickly`, `${fmtPct(bouncy.bounce)} of visits to ${bouncy.label} never reach 10 seconds of active time. Put the strongest piece or a clear invitation above the fold.`, "overview");
  const sticky = [...pages].filter((page) => page.avgActive !== null).sort((left, right) => right.avgActive - left.avgActive)[0];
  if (sticky && sticky.avgActive > 45) add("good", `${sticky.label} holds attention best`, `Visitors spend an average of ${fmtDuration(sticky.avgActive)} actively on this page, the longest of any section.`, "overview");

  // Search: demand and gaps
  const searchGroups = [
    ["search_papers", "Stories", "papers"], ["search_travel", "Dispatches", "travel"], ["search_faces", "Faces", "faces"],
  ];
  const missRows = topDims(agg.dims?.search_miss, 5);
  if (missRows.length && missRows[0].value >= 2) {
    add("tip", "Readers searched for things you have not written", `People looked for ${missRows.slice(0, 3).map((row) => `"${row.label.replace(/^[a-z]+: /, "")}"`).join(", ")} and found nothing. Those are ready-made topic ideas.`, "papers");
  }
  searchGroups.forEach(([event, label, section]) => {
    const top = topDims(agg.dims?.[event], 3);
    if (top.length && top[0].value >= 3) add("info", `Top ${label.toLowerCase()} search: "${top[0].label}"`, `Searched ${top[0].value} times. Consider featuring or following up on it.`, section);
  });

  // Per-kind content insights
  KINDS.forEach((kind) => {
    const kindRows = rows[kind] || [];
    const active = kindRows.filter((row) => row.opens >= 1);
    const noun = KIND_NOUN[kind].toLowerCase();
    if (active.length) {
      const best = [...active].sort((left, right) => right.score - left.score)[0];
      add("good", `Best ${noun}: ${best.title}`, `Leads ${KIND_TITLES[kind]} with ${fmtInt(best.opens)} ${best.opens === 1 ? "open" : "opens"} and the highest engagement score. Link to it from newer pieces and feature it.`, kind);
    }
    const unseen = kindRows.filter((row) => !row.removed && row.opens === 0 && isLiveItem(row.item));
    if (unseen.length && site.views >= 30) {
      add("tip", `${unseen.length} live ${noun}${unseen.length === 1 ? " has" : "s have"} no opens in this period`, `${unseen.slice(0, 3).map((row) => row.title).join(", ")}${unseen.length > 3 ? "…" : ""}. Give ${unseen.length === 1 ? "it" : "them"} a place in the next email or the featured slot.`, kind);
    }
  });

  // Papers
  const paperRows = (rows.papers || []).filter((row) => row.opens >= MIN_SAMPLE);
  const weakCta = paperRows.filter((row) => row.metrics.absActive > 40 && (row.metrics.fullRate ?? 0) < 0.1).sort((left, right) => right.opens - left.opens)[0];
  if (weakCta) add("tip", `"${weakCta.title}" is read but not clicked through`, `Readers spend ${fmtDuration(weakCta.metrics.absActive)} on the abstract but only ${fmtPct(weakCta.metrics.fullRate)} open the full paper. Make the PDF button more prominent or end the abstract with a call to read on.`, "papers");
  const quickExit = paperRows.filter((row) => row.metrics.absAvg !== null && row.metrics.absAvg < 12).sort((left, right) => right.opens - left.opens)[0];
  if (quickExit) add("warn", `"${quickExit.title}" is closed quickly`, `Average time on its abstract is only ${fmtDuration(quickExit.metrics.absAvg)}. The title may promise something the summary does not deliver; try tightening the first paragraph.`, "papers");
  const citeTotal = num(agg.totals?.paper_cite_copy);
  if (citeTotal >= 3) {
    const style = topDims(agg.dims?.paper_cite_copy, 1)[0];
    if (style) add("info", `${style.label.toUpperCase()} is the most-copied citation style`, `${fmtInt(citeTotal)} citations copied in total. Readers are using these academically, so keep citation details accurate.`, "papers");
  }

  // Photography
  const shootRows = (rows.photography || []).filter((row) => row.opens >= MIN_SAMPLE);
  const dropOff = shootRows.filter((row) => row.metrics.depth !== null && row.metrics.depth < 0.4).sort((left, right) => right.opens - left.opens)[0];
  if (dropOff) add("warn", `Viewers drop out early in "${dropOff.title}"`, `On average people only get ${fmtPct(dropOff.metrics.depth)} of the way through. Lead with the strongest frames or trim the weaker ones from the end.`, "photography");
  const finisher = shootRows.filter((row) => (row.metrics.completeRate ?? 0) > 0.5).sort((left, right) => right.metrics.completeRate - left.metrics.completeRate)[0];
  if (finisher) add("good", `"${finisher.title}" holds viewers to the last frame`, `${fmtPct(finisher.metrics.completeRate)} of viewers reach the end. Its pacing is a good template for future shoots.`, "photography");
  const totalZooms = num(agg.totals?.photo_zoom);
  const totalDownloads = num(agg.totals?.photo_download);
  if (totalZooms >= 10 && totalDownloads === 0) add("tip", "Photos are being zoomed but never downloaded", "Make the Download button more visible, or mention prints and licensing, since people clearly want a closer look.", "photography");

  // Faces
  const heroStarts = num(agg.totals?.faces_hero_start);
  if (heroStarts >= MIN_SAMPLE) {
    const heroFull = ratio(agg.totals?.faces_hero_full, heroStarts);
    if (heroFull !== null && heroFull < 0.3) add("warn", "Few visitors finish the Faces map scroll", `Only ${fmtPct(heroFull)} of people who start scrolling reveal every pin. The opening may be too long, so consider revealing pins faster or showing a "skip to archive" shortcut.`, "faces");
    const pinRate = ratio(agg.totals?.pin_click, agg.totals?.pin_reveal);
    if (pinRate !== null && num(agg.totals?.pin_reveal) >= 20 && pinRate < 0.05) add("tip", "Pins are seen but rarely clicked", `Only ${fmtPct(pinRate, 1)} of revealed pins get a click. A name plus a one-line hook on each pin could invite more taps.`, "faces");
  }

  // Travel
  const dispatchOpen = num(agg.totals?.dispatch_open);
  if (dispatchOpen >= MIN_SAMPLE) {
    const react = ratio(agg.totals?.dispatch_react, dispatchOpen);
    if (react !== null && react < 0.05) add("tip", "Dispatches get few reactions", `Only ${fmtPct(react, 1)} of opens lead to a reaction. Ending posts with a question or prompt to react tends to help.`, "travel");
    const finish = ratio(agg.totals?.dispatch_full, dispatchOpen);
    if (finish !== null && finish < 0.35) add("warn", "Most dispatches are not read to the end", `Only ${fmtPct(finish)} scroll to the bottom. Shorter pieces, subheadings or earlier photos may keep readers going.`, "travel");
  }
  const topFilter = topDims(agg.dims?.filter_travel, 1)[0];
  if (topFilter && topFilter.value >= 3) add("info", `Readers filter dispatches by "${topFilter.label}"`, `${topFilter.value} filter clicks make it the most-wanted category; plan more of that kind.`, "travel");

  // Subscribe funnel
  const subOpens = num(agg.totals?.subscribe_open);
  const subOk = num(agg.totals?.subscribe_ok);
  if (subOpens >= MIN_SAMPLE) {
    add(subOk / subOpens < 0.2 ? "warn" : "good", "Subscribe funnel", `${fmtInt(subOpens)} people opened a subscribe prompt and ${fmtInt(subOk)} completed one (${fmtPct(subOk / subOpens)}). ${subOk / subOpens < 0.2 ? "Shortening the form to just an email address usually helps." : "The form is converting well."}`, "overview");
  }

  // Email
  const sent = emails.filter((row) => row.reached >= 3);
  if (sent.length) {
    const bestOpen = [...sent].sort((left, right) => (right.openRate ?? 0) - (left.openRate ?? 0))[0];
    if (bestOpen.openRate) add("good", `Best subject line: "${bestOpen.subject}"`, `${fmtPct(bestOpen.openRate)} open rate, the highest of your sends. Reuse its style.`, "email");
    const lowClick = sent.find((row) => row.openRate > 0.3 && (row.clickToOpen ?? 0) < 0.1);
    if (lowClick) add("tip", `"${lowClick.subject}" was opened but not clicked`, `People opened it but only ${fmtPct(lowClick.clickToOpen)} clicked through. A single, more prominent button above the fold usually lifts click-through.`, "email");
    const engaged = [...sent].filter((row) => row.avgActive).sort((left, right) => right.avgActive - left.avgActive)[0];
    if (engaged) add("info", `Email readers stay longest after "${engaged.subject}"`, `They average ${fmtDuration(engaged.avgActive)} of active time and ${fmtDecimal(engaged.pagesPerLanding)} pages after clicking through.`, "email");
  }

  if (subscribersNew !== undefined && subscribersNew > 0 && site.views > 0) {
    add("good", `${subscribersNew} new verified subscriber${subscribersNew === 1 ? "" : "s"}`, `That is about ${fmtDecimal((subscribersNew / Math.max(1, site.uniques)) * 100)} per 100 visitors in this period.`, "overview");
  }
  const order = { warn: 0, tip: 1, good: 2, info: 3 };
  return insights.map((item, index) => ({ item, index })).sort((a, b) => (order[a.item.tone] - order[b.item.tone]) || (a.index - b.index)).map((entry) => entry.item);
}

export function isLiveItem(item) {
  return item?.status === "published" || Boolean(item?.publishedRecord?.slug);
}
