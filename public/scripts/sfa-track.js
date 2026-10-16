/*
 * Stories From Abroad - privacy-light engagement tracker.
 *
 * Loaded by every public page. Collects small events (page views, time, scroll depth, clicks on stories,
 * shoots, profiles, dispatches...) and posts them in batches to the `trackEvent` Cloud Function.
 * No cookies, no IP/user-agent storage, no visitor id sent to the server. "Unique" counts come from
 * first-today flags stored in this browser's localStorage.
 *
 * Page scripts use the small API on window.sfaTrack:
 *   sfaTrack.key("papers", slug)                       -> "papers:slug" (normalised item key)
 *   sfaTrack.event(name, { item, detail, value })      -> one event (counts; auto first-today "unique" flag)
 *   sfaTrack.dwell(name, item)  -> { stop() }          -> visible + active seconds as name_sec / name_act
 *   sfaTrack.progress(name, item, pct, fullAt)         -> max depth as name_pct, plus name_full when pct >= fullAt
 *   sfaTrack.away(name, item)                          -> seconds spent away after a link opens elsewhere (name_sec)
 *   sfaTrack.search(section, term, hits)               -> debounced search + miss tracking
 *   sfaTrack.flush()
 *
 * On localhost nothing is sent; events are kept in window.__sfaLog for debugging.
 */
(function () {
  "use strict";
  if (window.sfaTrack) return;

  var script = document.currentScript;
  var endpoint = (script && script.getAttribute("data-endpoint")) || "";
  var host = window.location.hostname;
  var isLocal = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /\.local$/.test(host);
  var IDLE_MS = 15000;     // no input for this long = not "active"
  var FLUSH_MS = 20000;
  var MAX_QUEUE = 30;

  var optedOut = false;
  try { optedOut = window.localStorage.getItem("sfa-no-track") === "1"; } catch (error) { /* storage blocked */ }
  var looksAutomated = /bot|crawl|spider|slurp|headless|lighthouse|prerender/i.test(navigator.userAgent || "");
  var canSend = Boolean(endpoint) && !isLocal && !optedOut && !looksAutomated;
  var collect = !optedOut;  // keep collecting locally for debugging even when not sending
  if (!collect) { window.sfaTrack = { event: noop, dwell: function () { return { stop: noop }; }, progress: noop, away: noop, search: noop, flush: noop, key: function () { return ""; }, enabled: false }; return; }
  function noop() {}

  var log = window.__sfaLog = [];

  // ---------- storage helpers ----------
  function lsGet(key) { try { return window.localStorage.getItem(key); } catch (error) { return null; } }
  function lsSet(key, value) { try { window.localStorage.setItem(key, value); } catch (error) { /* ignore */ } }
  function ssGet(key) { try { return window.sessionStorage.getItem(key); } catch (error) { return null; } }
  function ssSet(key, value) { try { window.sessionStorage.setItem(key, value); } catch (error) { /* ignore */ } }
  function today() { return new Date().toISOString().slice(0, 10); }

  // First-today flags: [event|item|detail] -> seen. Stored per UTC day to match the server rollup day.
  function firstToday(key) {
    var day = today();
    var state;
    try { state = JSON.parse(lsGet("sfa-udays") || "null"); } catch (error) { state = null; }
    if (!state || state.d !== day || !state.k) state = { d: day, k: {} };
    if (state.k[key]) return false;
    state.k[key] = 1;
    if (Object.keys(state.k).length < 800) lsSet("sfa-udays", JSON.stringify(state));
    return true;
  }

  // ---------- visit context ----------
  var url = new URL(window.location.href);
  var urlSrc = (url.searchParams.get("src") || "").toLowerCase();
  var urlCamp = url.searchParams.get("c") || "";
  var firstSeen = lsGet("sfa-first-seen");
  var isNewVisitor = !firstSeen;
  if (!firstSeen) lsSet("sfa-first-seen", today());
  var isReturning = Boolean(firstSeen) && firstSeen < today();
  var newSession = !ssGet("sfa-sid");
  if (newSession) ssSet("sfa-sid", Math.random().toString(36).slice(2));
  if (urlSrc) ssSet("sfa-src", urlSrc);
  if (urlCamp) ssSet("sfa-camp", urlCamp);
  var sessionSrc = ssGet("sfa-src") || "";
  var sessionCamp = ssGet("sfa-camp") || "";
  var isLanding = Boolean(urlSrc || urlCamp);

  function deviceClass() {
    var w = Math.min(window.screen ? window.screen.width : window.innerWidth, window.innerWidth || 9999);
    var touch = (navigator.maxTouchPoints || 0) > 0;
    if (w < 700) return "mobile";
    if (touch && w < 1100) return "tablet";
    return "desktop";
  }

  // ---------- time accounting ----------
  var lastActive = Date.now();
  var lastTick = Date.now();
  var page = { sec: 0, act: 0, sentSec: 0, sentAct: 0, maxPct: 0, sentPct: 0, fullSent: false, milestones: { 10: false, 30: false, 60: false, 180: false } };
  var timers = {};     // dwell timers keyed by name|item
  var progresses = {}; // progress trackers keyed by name|item
  var queue = [];
  var awaiting = null; // pending "away" measurement

  function markActive() { lastActive = Date.now(); }
  ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll", "click"].forEach(function (type) {
    window.addEventListener(type, markActive, { passive: true, capture: true });
  });

  function visible() { return document.visibilityState === "visible"; }

  function tick() {
    var now = Date.now();
    var dt = Math.min(now - lastTick, 5000) / 1000;
    lastTick = now;
    if (!visible()) return;
    var active = now - lastActive < IDLE_MS ? dt : 0;
    page.sec += dt;
    page.act += active;
    Object.keys(timers).forEach(function (key) {
      timers[key].sec += dt;
      timers[key].act += active;
    });
    [10, 30, 60, 180].forEach(function (mark) {
      if (!page.milestones[mark] && page.act >= mark) {
        page.milestones[mark] = true;
        push({ n: "pg_t" + mark });
      }
    });
  }
  setInterval(tick, 1000);

  // ---------- queue + sending ----------
  var metaSent = false;
  var pageviewSent = false;

  function push(event) {
    queue.push(event);
    if (queue.length >= MAX_QUEUE) flush(false);
  }

  function round1(value) { return Math.round(value * 10) / 10; }

  function collectDeltas() {
    tick();
    var dsec = page.sec - page.sentSec;
    var dact = page.act - page.sentAct;
    if (pageviewSent && dsec >= 0.5) { queue.push({ n: "pg_sec", v: round1(dsec) }); page.sentSec = page.sec; }
    if (pageviewSent && dact >= 0.5) { queue.push({ n: "pg_act", v: round1(dact) }); page.sentAct = page.act; }
    if (pageviewSent && page.maxPct > page.sentPct) {
      queue.push({ n: "pg_scroll", v: page.maxPct - page.sentPct });
      page.sentPct = page.maxPct;
    }
    if (pageviewSent && page.maxPct >= 90 && !page.fullSent) { page.fullSent = true; queue.push({ n: "pg_full" }); }
    Object.keys(timers).forEach(function (key) {
      var timer = timers[key];
      var s = timer.sec - timer.sentSec;
      var a = timer.act - timer.sentAct;
      if (s >= 0.5) { queue.push({ n: timer.name + "_sec", i: timer.item, v: round1(s) }); timer.sentSec = timer.sec; }
      if (a >= 0.5) { queue.push({ n: timer.name + "_act", i: timer.item, v: round1(a) }); timer.sentAct = timer.act; }
    });
    Object.keys(progresses).forEach(function (key) {
      var prog = progresses[key];
      if (prog.max > prog.sent) {
        queue.push({ n: prog.name + "_pct", i: prog.item, v: prog.max - prog.sent });
        prog.sent = prog.max;
      }
    });
  }

  function flush(final) {
    collectDeltas();
    if (!queue.length) return;
    var events = queue.splice(0, queue.length);
    var payload = {
      v: 2,
      p: window.location.pathname,
      host: host,
      src: sessionSrc,
      camp: sessionCamp,
      events: events,
    };
    if (!metaSent) {
      metaSent = true;
      payload.meta = true;
      payload.s = newSession;
      payload.first = firstToday("visit");
      payload.ret = isReturning;
      payload.dev = deviceClass();
      payload.h = new Date().getHours();
      payload.lang = (navigator.language || "").slice(0, 8);
      payload.ref = document.referrer;
      payload.L = isLanding;
    }
    send(payload, final);
  }

  function send(payload, final) {
    log.push(payload);
    if (isLocal && window.console && console.debug) console.debug("[sfa-track]", payload);
    if (!canSend) return;
    var json = JSON.stringify(payload);
    try {
      var blob = new Blob([json], { type: "text/plain" });
      if (navigator.sendBeacon && navigator.sendBeacon(endpoint, blob)) return;
      fetch(endpoint, { method: "POST", body: blob, keepalive: true, mode: "no-cors" }).catch(noop);
    } catch (error) { /* tracking must never break the page */ }
  }

  setInterval(function () { if (visible()) flush(false); }, FLUSH_MS);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      if (awaiting && !awaiting.hiddenAt && Date.now() - awaiting.at < 6000) awaiting.hiddenAt = Date.now();
      flush(true);
    } else {
      lastTick = Date.now();
      if (awaiting && awaiting.hiddenAt) {
        var away = (Date.now() - awaiting.hiddenAt) / 1000;
        push({ n: awaiting.name + "_sec", i: awaiting.item, v: Math.min(1800, round1(away)) });
        awaiting = null;
        flush(false);
      }
    }
  });
  window.addEventListener("pagehide", function () { flush(true); });

  // ---------- public API ----------
  function slugify(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  }

  function key(kind, slug) {
    var clean = slugify(slug);
    return clean ? kind + ":" + clean : "";
  }

  function event(name, opts) {
    opts = opts || {};
    var e = { n: name };
    if (opts.item) e.i = opts.item;
    if (opts.value != null) e.v = round1(Number(opts.value) || 0);
    if (opts.detail) e.x = String(opts.detail).slice(0, 80);
    if (opts.item && opts.value == null && opts.unique !== false) {
      if (firstToday(name + "|" + opts.item)) e.u = 1;
    }
    push(e);
  }

  function dwell(name, item) {
    var id = name + "|" + (item || "");
    if (timers[id]) stopDwell(id);
    timers[id] = { name: name, item: item || "", sec: 0, act: 0, sentSec: 0, sentAct: 0 };
    return { stop: function () { stopDwell(id); } };
  }

  function stopDwell(id) {
    if (!timers[id]) return;
    tick();
    var timer = timers[id];
    var s = timer.sec - timer.sentSec;
    var a = timer.act - timer.sentAct;
    if (s >= 0.5) queue.push({ n: timer.name + "_sec", i: timer.item || undefined, v: round1(s) });
    if (a >= 0.5) queue.push({ n: timer.name + "_act", i: timer.item || undefined, v: round1(a) });
    delete timers[id];
    if (queue.length) flush(false);
  }

  // Start (or restart) a depth tracker. Call progress() with 0-100 as the reader moves.
  function progress(name, item, pct, fullAt) {
    var id = name + "|" + (item || "");
    var prog = progresses[id];
    if (!prog) prog = progresses[id] = { name: name, item: item || "", max: 0, sent: 0, fullSent: false };
    var value = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    if (value > prog.max) prog.max = value;
    if (!prog.fullSent && prog.max >= (fullAt || 90)) {
      prog.fullSent = true;
      event(name + "_full", { item: item || undefined });
    }
  }

  function resetProgress(name, item) {
    var id = name + "|" + (item || "");
    var prog = progresses[id];
    if (prog && prog.max > prog.sent) {
      queue.push({ n: prog.name + "_pct", i: prog.item || undefined, v: prog.max - prog.sent });
    }
    delete progresses[id];
  }

  function away(name, item) {
    awaiting = { name: name, item: item, at: Date.now(), hiddenAt: 0 };
  }

  // Debounced search tracking: logs the final term once typing pauses, plus a miss when nothing matched.
  var searchTimers = {};
  var lastSearch = {};
  function search(section, term, hits) {
    var text = String(term || "").trim();
    clearTimeout(searchTimers[section]);
    if (text.length < 2) return;
    searchTimers[section] = setTimeout(function () {
      if (lastSearch[section] === text.toLowerCase()) return;
      lastSearch[section] = text.toLowerCase();
      event("search_" + section, { detail: text });
      if (hits === 0) event("search_miss", { detail: section + ": " + text });
    }, 1100);
  }

  // ---------- scroll depth for the page itself ----------
  var scrollQueued = false;
  function measureScroll() {
    scrollQueued = false;
    var doc = document.documentElement;
    var viewport = window.innerHeight || 1;
    var height = Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0);
    if (height <= viewport * 1.15) return;
    var pct = Math.round(((window.scrollY + viewport) / height) * 100);
    if (pct > page.maxPct) page.maxPct = Math.min(100, pct);
  }
  window.addEventListener("scroll", function () {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(measureScroll);
  }, { passive: true });

  // ---------- generic click hooks ----------
  document.addEventListener("click", function (domEvent) {
    var target = domEvent.target && domEvent.target.closest ? domEvent.target.closest("a, button, [data-subscribe-open], [data-modal-open]") : null;
    if (!target) return;
    if (target.matches("[data-subscribe-open], [data-modal-open='subscribe']")) {
      event("subscribe_open", { detail: target.getAttribute("data-subscribe-open") || "site" });
    }
    if (target.matches("[data-subscribe-submit], #modal-submit")) {
      event("subscribe_submit", { detail: window.location.pathname.replace(/\//g, "") || "home" });
    }
    if (target.tagName === "A" && target.href) {
      try {
        var link = new URL(target.href, window.location.href);
        if (/^https?:$/.test(link.protocol) && link.hostname !== host) {
          event("outbound", { detail: link.hostname.replace(/^www\./, "") });
        }
      } catch (error) { /* ignore */ }
    }
  }, true);

  // ---------- the page view itself ----------
  function sendPageview() {
    if (pageviewSent) return;
    pageviewSent = true;
    var e = { n: "pg_view" };
    if (firstToday("pg|" + window.location.pathname)) e.u = 1;
    queue.push(e);
    flush(false);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sendPageview);
  else sendPageview();

  window.sfaTrack = {
    enabled: true,
    key: key,
    slug: slugify,
    event: event,
    dwell: dwell,
    progress: progress,
    resetProgress: resetProgress,
    away: away,
    search: search,
    flush: function () { flush(false); },
    campaign: sessionCamp,
    source: sessionSrc,
  };
})();
