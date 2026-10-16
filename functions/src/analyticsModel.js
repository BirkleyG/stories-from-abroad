// Pure event -> Firestore update mapping for the analytics beacon (no Firebase imports, so it can be tested offline).
//
// The browser (public/scripts/sfa-track.js) batches small events and posts them here. Each event is
//   { n: name, i?: itemKey, v?: number, x?: detail, u?: 1 }
// and is folded into one daily rollup document:
//
//   pages:   { <path>:      { pg_view, pg_view_u, pg_sec, pg_act, pg_scroll, pg_full, pg_t10..pg_t180, entries } }
//   items:   { <kind:slug>: { <event>, <event>_u, ... } }
//   totals:  { <event>, <event>_u }
//   dims:    { <event>:     { <detail>: count } }      (searches, filters, cite styles...)
//   idims:   { <item>: { <event>: { <detail>: count } } }   (per-photo views, reactions, open sources...)
//   sources: { <src>:       { landings, views, sec, act, actions } }
//   camps:   { <sendId>:    { landings, views, sec, act, actions } }   (email click-throughs + what happened next)
//
// No IPs, cookies or user agents ever reach the server.

// "c" = counter (+1 per event), "v" = value sum (seconds or percent points, clamped).
export const EVENT_DEFS = {
  // ---- every page ----
  pg_view: "c", pg_full: "c", pg_t10: "c", pg_t30: "c", pg_t60: "c", pg_t180: "c",
  pg_sec: "v", pg_act: "v", pg_scroll: "v",
  outbound: "c", subscribe_open: "c", subscribe_submit: "c", subscribe_ok: "c",

  // ---- Selected Papers ----
  paper_open: "c",          // clicked into an article
  paper_abs_sec: "v",       // seconds the article overlay (abstract) was open and visible
  paper_abs_act: "v",       // ...of which actively reading
  paper_read_pct: "v",      // max scroll depth inside the overlay (percent points, summed per open)
  paper_read_full: "c",     // scrolled to the bottom of the overlay
  paper_full_click: "c",    // clicked through to the full paper (PDF / publication)
  paper_full_sec: "v",      // seconds away from the site after that click (best estimate of reading time)
  paper_text_dl: "c",       // downloaded the clean text
  paper_cite_copy: "c",     // copied a citation (detail = style)
  search_papers: "c", filter_papers: "c",

  // ---- Photography ----
  shoot_open: "c", shoot_sec: "v", shoot_act: "v", shoot_pct: "v", shoot_full: "c",
  photo_view: "c", photo_zoom: "c", photo_download: "c",
  feat_click: "c",

  // ---- Faces of the World ----
  faces_hero_start: "c", faces_hero_pct: "v", faces_hero_full: "c",
  pin_reveal: "c", pin_click: "c",
  archive_open: "c", archive_start: "c", archive_pct: "v", archive_full: "c", archive_view: "c",
  story_open: "c", story_sec: "v", story_act: "v", story_pct: "v", story_full: "c", story_photo_zoom: "c",
  about_open: "c",
  search_faces: "c", filter_faces: "c",

  // ---- Travel Dispatches ----
  dispatch_open: "c", dispatch_sec: "v", dispatch_act: "v", dispatch_pct: "v", dispatch_full: "c",
  dispatch_photo_click: "c", dispatch_react: "c", dispatch_comment: "c",
  search_travel: "c", filter_travel: "c",

  // ---- search misses (content gaps), any section ----
  search_miss: "c",
};

// Per-photo / per-emoji details only make sense per item, so they are not duplicated into the global dims.
const NO_GLOBAL_DIMS = new Set(["photo_view", "photo_zoom", "photo_download", "dispatch_photo_click", "pin_reveal"]);

export const ITEM_KEY = /^(papers|travel|photography|faces):[a-z0-9][a-z0-9_-]{0,89}$/;
const CAMP_RE = /^[A-Za-z0-9_-]{6,40}$/;
const SOURCE_RE = /^[a-z0-9_-]{1,24}$/;
const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,60}[a-z0-9])?$/;
const DEVICES = new Set(["mobile", "tablet", "desktop"]);

export const KNOWN_PATHS = new Set([
  "/",
  "/selected-papers/",
  "/photography/",
  "/travel-stories/",
  "/faces-of-the-world/",
  "/read-the-story/",
  "/subscriber-settings/",
  "/unsubscribe/",
  "/email-verified/",
]);

export function mapKey(value) {
  const key = String(value).replace(/[.\/\[\]*`~\s]/g, "_").slice(0, 90);
  return key && !/^__.*__$/.test(key) ? key : "_";
}

export function normalizePath(raw) {
  let path = String(raw || "/").split("?")[0].split("#")[0].trim().toLowerCase();
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.endsWith("/")) path = `${path}/`;
  path = path.replace(/\/+/g, "/");
  if (KNOWN_PATHS.has(path)) return path;
  if (/^\/selected-papers\/(drafts|unpublished)\/$/.test(path)) return "/selected-papers/";
  return "";
}

export function referrerHost(raw, ownHost) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "direct";
  const host = value.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
  if (!HOST_RE.test(host)) return "other";
  if (ownHost && host === ownHost) return "direct";
  return host;
}

// Detail strings: search terms, filter choices, citation styles, photo ids. Keep them short and tidy.
export function cleanDetail(value) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 48);
  if (!text) return "";
  if (text.includes("@")) return "";                    // never store anything email-shaped
  if ((text.match(/\d/g) || []).length > 8) return "";  // or phone-number-shaped
  return text;
}

function clampValue(name, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (name.endsWith("_pct") || name === "pg_scroll") return Math.min(100, Math.round(value));
  return Math.min(1800, Math.round(value * 10) / 10);
}

// `inc` is injected so tests can run without firebase-admin.
export function buildAnalyticsUpdate(body, { inc, now = new Date() }) {
  const path = normalizePath(body?.p);
  if (!path) return null;
  const date = now.toISOString().slice(0, 10);
  const update = { date };
  const pathKey = mapKey(path);

  const put = (keys, amount) => {
    let node = update;
    for (let index = 0; index < keys.length - 1; index += 1) {
      node[keys[index]] = node[keys[index]] || {};
      node = node[keys[index]];
    }
    const last = keys[keys.length - 1];
    node[last] = inc(amount);
  };

  const source = String(body.src || "").trim().toLowerCase();
  const sourceKey = SOURCE_RE.test(source) ? mapKey(source) : "";
  const campRaw = String(body.camp || "").trim();
  const campKey = CAMP_RE.test(campRaw) ? mapKey(campRaw) : "";
  const attribution = [];
  if (sourceKey) attribution.push(["sources", sourceKey]);
  if (campKey) attribution.push(["camps", campKey]);

  // ---- once-per-page-load context ----
  if (body.meta === true) {
    if (body.s === true) {
      put(["sessions"], 1);
      put(["entries", pathKey], 1);
    }
    if (body.first === true) {
      put(["uniques"], 1);
      put([body.ret === true ? "returning" : "newVisitors"], 1);
    }
    const device = String(body.dev || "");
    if (DEVICES.has(device)) put(["devices", device], 1);
    const hour = Number(body.h);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) put(["hours", String(hour)], 1);
    const lang = String(body.lang || "").toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8);
    if (lang) put(["langs", mapKey(lang)], 1);
    const ref = referrerHost(body.ref, String(body.host || "").toLowerCase().replace(/^www\./, ""));
    put(["referrers", mapKey(ref)], 1);
    if (body.L === true) attribution.forEach(([group, key]) => put([group, key, "landings"], 1));
  }

  const events = Array.isArray(body.events) ? body.events.slice(0, 60) : [];
  for (const event of events) {
    const name = String(event?.n || "");
    const type = EVENT_DEFS[name];
    if (!type) continue;
    const isValue = type === "v";
    const amount = isValue ? clampValue(name, event.v) : 1;
    if (!amount) continue;
    const unique = event.u === 1 || event.u === true;

    if (name.startsWith("pg_")) {
      put(["pages", pathKey, name], amount);
      if (unique && name === "pg_view") put(["pages", pathKey, "pg_view_u"], 1);
      if (name === "pg_view") {
        put(["views"], 1);
        put(["sessPages"], 1);
        attribution.forEach(([group, key]) => put([group, key, "views"], 1));
      }
      if (name === "pg_sec") {
        put(["sec"], amount);
        attribution.forEach(([group, key]) => put([group, key, "sec"], amount));
      }
      if (name === "pg_act") {
        put(["act"], amount);
        attribution.forEach(([group, key]) => put([group, key, "act"], amount));
      }
      continue;
    }

    const item = String(event.i || "").trim().toLowerCase();
    if (item) {
      if (!ITEM_KEY.test(item)) continue;
      put(["items", mapKey(item), name], amount);
      if (unique && !isValue) put(["items", mapKey(item), `${name}_u`], 1);
    }
    put(["totals", name], amount);
    if (unique && !isValue) put(["totals", `${name}_u`], 1);

    const detail = cleanDetail(event.x);
    if (detail && !isValue) {
      if (item) put(["idims", mapKey(item), name, mapKey(detail)], 1);
      if (!NO_GLOBAL_DIMS.has(name)) put(["dims", name, mapKey(detail)], 1);
    }

    // Deliberate actions (opens, clicks, downloads, reactions...) count toward click-through engagement.
    if (!isValue && name !== "outbound") {
      attribution.forEach(([group, key]) => put([group, key, "actions"], 1));
    }
  }
  return { id: date, update };
}
