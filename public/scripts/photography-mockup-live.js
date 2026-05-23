(function () {
  var LIVE_SHOOTS = {};
  var ADMIN_PREVIEW_STORAGE_KEY = "sfa-admin-preview-v1";
  var featuredRotatorState = { timer: null, raf: null, index: 0, start: 0, interval: 5000 };
  var currentAccentColor = "#FF2D78";
  var shootAccentLock = null;
  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch {
      return String(value || "");
    }
  }

  function readJsonScript(id, fallback) {
    var node = document.getElementById(id);
    if (!node) return fallback;
    try {
      return JSON.parse(node.textContent || "null") || fallback;
    } catch {
      return fallback;
    }
  }

  function writeShootParam(slug) {
    if (typeof window === "undefined") return;
    try {
      var url = new URL(window.location.href);
      if (slug) {
        url.searchParams.set("shoot", String(slug));
      } else {
        url.searchParams.delete("shoot");
      }
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Ignore URL update failures.
    }
  }

  function installRuntimeGlobals() {
    if (typeof window.setDotColor !== "function") {
      window.setDotColor = function setDotColorFallback(color) {
        document.documentElement.style.setProperty("--dot-color", String(color || "#FF2D78"));
      };
    }
    if (typeof window.playShutter !== "function") {
      window.playShutter = function playShutterFallback() {};
    }
  }

  function applyAccent(color) {
    var next = String(color || currentAccentColor || "#FF2D78");
    currentAccentColor = next;
    if (typeof window.setDotColor === "function") {
      window.setDotColor(next);
    }
  }

  function getActiveFeaturedAccent() {
    var active = document.querySelector("#feat-track .fslide.active");
    var accent = String(active?.style.getPropertyValue("--accent") || "").trim();
    return accent || currentAccentColor || "#FF2D78";
  }

  function installPageRouter() {
    var suppressInitialShootParamClear = false;
    try {
      suppressInitialShootParamClear = Boolean(new URL(window.location.href).searchParams.get("shoot"));
    } catch {
      suppressInitialShootParamClear = false;
    }

    window.showPage = function showPage(id) {
      var pageId = "page-" + String(id || "index");
      Array.from(document.querySelectorAll(".page")).forEach(function (page) {
        var isTarget = page.id === pageId;
        page.classList.toggle("active", isTarget);
        page.style.display = isTarget ? "block" : "none";
      });

      document.querySelectorAll(".nav-link").forEach(function (link) {
        link.classList.remove("cur");
      });
      if (id === "about") {
        var aboutLink = document.getElementById("nav-about");
        if (aboutLink) aboutLink.classList.add("cur");
      } else {
        var photoLink = document.getElementById("nav-photo");
        if (photoLink) photoLink.classList.add("cur");
      }

      if (id !== "shoot") {
        if (suppressInitialShootParamClear) {
          suppressInitialShootParamClear = false;
        } else {
          writeShootParam("");
        }
        window.scrollTo(0, 0);
        var mobileBar = document.getElementById("mob-bar");
        if (mobileBar) mobileBar.style.display = "none";
        if (id === "index") {
          shootAccentLock = null;
          currentAccentColor = getActiveFeaturedAccent();
        }
        applyAccent(shootAccentLock || currentAccentColor);
      }
    };

    var photoNav = document.getElementById("nav-photo");
    if (photoNav) photoNav.addEventListener("click", function () { window.showPage("index"); });

    var backLogo = document.querySelector(".nav-logo");
    if (backLogo) {
      backLogo.addEventListener("click", function (event) {
        var shootPage = document.getElementById("page-shoot");
        if (shootPage && shootPage.classList.contains("active")) {
          event.preventDefault();
          window.showPage("index");
        }
      });
    }

    var aboutNav = document.getElementById("nav-about");
    if (aboutNav) aboutNav.addEventListener("click", function () { window.showPage("about"); });

    Array.from(document.querySelectorAll(".ab-photos-link")).forEach(function (link) {
      link.addEventListener("click", function () { window.showPage("index"); });
    });

    var activeId = String(document.querySelector(".page.active")?.id || "page-index").replace("page-", "");
    window.showPage(activeId || "index");
  }

  
  function readAdminPreviewShoot() {
    if (typeof window === "undefined") return null;
    try {
      var url = new URL(window.location.href);
      if (url.searchParams.get("adminPreview") !== "1") return null;
      var raw = window.sessionStorage ? window.sessionStorage.getItem(ADMIN_PREVIEW_STORAGE_KEY) : "";
      if (!raw && window.localStorage) {
        raw = window.localStorage.getItem(ADMIN_PREVIEW_STORAGE_KEY) || "";
      }
      if (!raw) return null;
      var payload = JSON.parse(raw);
      if (!payload || payload.kind !== "photography" || !payload.data || typeof payload.data !== "object") return null;
      return {
        id: String(payload.draftId || payload.data.id || payload.data.slug || "preview-shoot"),
        ...payload.data,
      };
    } catch {
      return null;
    }
  }
  function toDate(value) {
    if (!value) return null;
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatMonthYear(value) {
    var date = toDate(value);
    if (!date) return "";
    return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }

  function normalizeTheme(theme, template) {
    var normalized = String(theme || "").trim().toLowerCase();
    if (normalized === "editorial" || normalized === "documentary" || normalized === "cinematic") {
      return normalized;
    }
    var templateKey = String(template || "").trim().toLowerCase();
    if (templateKey === "tokyo-fragments") return "editorial";
    if (templateKey === "desert-fill") return "documentary";
    if (templateKey === "kyoto-bold" || templateKey === "desert-bloom") return "cinematic";
    return "editorial";
  }

  function normalizeTags(raw) {
    if (Array.isArray(raw?.tags)) {
      return raw.tags.map(function (tag) { return String(tag || "").trim(); }).filter(Boolean).slice(0, 3);
    }
    var tags = [raw?.tagWord1, raw?.tagWord2, raw?.tagWord3]
      .map(function (tag) { return String(tag || "").trim(); })
      .filter(Boolean);
    if (!tags.length && raw?.descriptor) tags.push(String(raw.descriptor));
    return tags.slice(0, 3);
  }

  function normalizeLocation(raw) {
    var location = String(raw?.locationLabel || "").trim();
    if (location) return location;
    var city = String(raw?.city || "").trim();
    var country = String(raw?.country || "").trim();
    return [city, country].filter(Boolean).join(", ");
  }

  function normalizePhotos(rawShoot) {
    var baseLocation = normalizeLocation(rawShoot);
    var baseDate = rawShoot?.shootDate || "";
    var rawPhotos = Array.isArray(rawShoot?.allPhotos) ? rawShoot.allPhotos.slice() : [];
    if (!rawPhotos.length && rawShoot?.coverPhoto?.url) {
      rawPhotos.push(rawShoot.coverPhoto);
    }

    return rawPhotos
      .map(function (photo, index) {
        var src = String(photo?.url || "").trim();
        if (!src) return null;
        var title = String(photo?.title || photo?.caption || "").trim() || "Frame " + String(index + 1).padStart(2, "0");
        var caption = String(photo?.caption || "").trim();
        var location = String(photo?.locationLabel || "").trim() || baseLocation;
        var camera = String(photo?.cameraModel || rawShoot?.cameraModel || "").trim();
        var dateLabel = formatMonthYear(photo?.exifDate || baseDate) || formatMonthYear(baseDate);
        return {
          id: String(photo?.id || "p" + (index + 1)),
          src: src,
          title: title,
          caption: caption,
          quote: String(photo?.shortQuote || "").trim() || caption,
          location: location,
          date: dateLabel,
          camera: camera,
          lens: String(photo?.lens || "").trim(),
          shutter: String(photo?.shutter || "").trim(),
          aperture: String(photo?.aperture || "").trim(),
          iso: String(photo?.iso || "").trim(),
          metadataEnabled: photo?.metadataEnabled !== false,
          width: Number.isFinite(Number(photo?.width)) ? Number(photo.width) : null,
          height: Number.isFinite(Number(photo?.height)) ? Number(photo.height) : null,
        };
      })
      .filter(Boolean);
  }

  function normalizeShoot(rawShoot, order) {
    var slug = String(rawShoot?.slug || rawShoot?.id || "").trim();
    if (!slug) return null;

    var photos = normalizePhotos(rawShoot);
    var tags = normalizeTags(rawShoot);
    var location = normalizeLocation(rawShoot);
    var accent = String(rawShoot?.accentColor || "").trim() || "#FF2D78";
    var shootDate = rawShoot?.shootDate || "";
    var cover = String(rawShoot?.coverPhoto?.url || photos[0]?.src || "").trim();
    var camera = String(rawShoot?.cameraModel || photos.find(function (photo) { return photo.camera; })?.camera || "").trim();
    var lens = String(rawShoot?.lens || photos.find(function (photo) { return photo.lens; })?.lens || "").trim();

    return {
      id: String(rawShoot?.id || ""),
      slug: slug,
      order: order,
      title: String(rawShoot?.title || "Untitled shoot"),
      location: location,
      date: formatMonthYear(shootDate),
      intro: String(rawShoot?.description || rawShoot?.notes || rawShoot?.subtitle || "").trim(),
      tags: tags,
      accent: accent,
      camera: camera,
      lens: lens,
      template: normalizeTheme(rawShoot?.theme, rawShoot?.template),
      titles: photos.map(function (photo) { return photo.title; }),
      captions: photos.map(function (photo) { return photo.caption; }),
      cover: cover,
      photos: photos,
      photoCount: Number(rawShoot?.frameCount) || photos.length,
    };
  }

  function replaceShootsRegistry(shoots) {
    LIVE_SHOOTS = {};
    shoots.forEach(function (shoot, index) {
      LIVE_SHOOTS[shoot.slug] = { ...shoot, order: index + 1 };
    });
  }

  function patchArchiveGrid(shoots) {
    var grid = document.querySelector(".shoots-grid");
    if (!grid) return;
    if (!shoots.length) {
      grid.innerHTML = '' +
        '<article class="sc" style="grid-column:1 / -1;cursor:default;pointer-events:none;transform:none">' +
          '<div class="sc-body">' +
            '<div class="sc-title">No published shoots yet</div>' +
            '<div class="sc-desc" style="display:block;margin-bottom:0">Publish a photography shoot from Admin to fill the archive.</div>' +
          "</div>" +
          '<div class="sc-bar" style="height:3px;background:#282828"></div>' +
        "</article>";
      return;
    }
    grid.innerHTML = shoots.map(function (shoot) {
      var tags = (shoot.tags || []).map(function (tag) { return '<span class="sc-tag">' + esc(tag) + "</span>"; }).join("");
      return '' +
        '<article class="sc" data-shoot-slug="' + esc(shoot.slug) + '" style="--accent:' + esc(shoot.accent) + '">' +
          '<div class="sc-img-w"><img class="sc-img" src="' + esc(shoot.cover || "") + '" alt="' + esc(shoot.title) + '" loading="lazy"/></div>' +
          '<div class="sc-body">' +
            '<div class="sc-top"><span class="sc-date">' + esc(shoot.date || "") + '</span><span class="sc-ct">' + esc(String(shoot.photoCount || 0)) + ' frames</span></div>' +
            '<div class="sc-title">' + esc(shoot.title) + '</div>' +
            '<div class="sc-desc">' + esc(shoot.intro || "") + '</div>' +
            '<div class="sc-tags">' + tags + '</div>' +
            '<div class="sc-loc">' + esc(shoot.location || "") + '</div>' +
          '</div>' +
          '<div class="sc-bar"></div>' +
        "</article>";
    }).join("");
    Array.from(grid.querySelectorAll("[data-shoot-slug]")).forEach(function (card) {
      card.addEventListener("click", function () {
        if (typeof window.showShoot !== "function") return;
        var slug = String(card.getAttribute("data-shoot-slug") || "").trim();
        if (slug) window.showShoot(slug);
      });
    });
  }

  function patchAboutRecent(shoots) {
    var grid = document.getElementById("ab-photos-grid");
    if (!grid) return;
    if (!shoots.length) {
      grid.innerHTML = '' +
        '<article class="ab-shoot-card" style="grid-column:1 / -1;aspect-ratio:auto;min-height:180px;display:grid;place-items:center;padding:1.2rem;cursor:default">' +
          '<div class="ab-shoot-card-title" style="font-size:30px">No recent shoots</div>' +
        "</article>";
      return;
    }
    grid.innerHTML = shoots.slice(0, 3).map(function (shoot) {
      return '' +
        '<article class="ab-shoot-card" data-shoot-slug="' + esc(shoot.slug) + '">' +
          '<img src="' + esc(shoot.cover || "") + '" alt="' + esc(shoot.title) + '" loading="lazy"/>' +
          '<div class="ab-shoot-card-over">' +
            '<div class="ab-shoot-card-title">' + esc(shoot.title) + '</div>' +
            '<div class="ab-shoot-card-loc">' + esc(shoot.location || "") + '</div>' +
          '</div>' +
          '<div class="ab-shoot-card-bar" style="background:' + esc(shoot.accent) + '"></div>' +
        "</article>";
    }).join("");
    Array.from(grid.querySelectorAll("[data-shoot-slug]")).forEach(function (card) {
      card.addEventListener("click", function () {
        if (typeof window.showShoot !== "function") return;
        var slug = String(card.getAttribute("data-shoot-slug") || "").trim();
        if (slug) window.showShoot(slug);
      });
    });
  }

  function applyEmptyState(message) {
    replaceShootsRegistry([]);
    patchFeaturedSlides([]);
    patchArchiveGrid([]);
    patchAboutRecent([]);
    var note = document.querySelector(".ab-photos-note");
    if (note) {
      note.textContent = String(message || "No photography shoots have been published yet.");
    }
    document.body.classList.remove("photo-loading");
  }

  function setCurrentField(label, value) {
    if (!value) return;
    Array.from(document.querySelectorAll(".ab-cur-row")).forEach(function (row) {
      var key = row.querySelector(".ab-cur-k");
      var val = row.querySelector(".ab-cur-v");
      if (!key || !val) return;
      if (String(key.textContent || "").trim().toLowerCase() === String(label).toLowerCase()) {
        val.textContent = String(value);
      }
    });
  }

  function patchAboutAdminInfo(sectionMedia) {
    if (!sectionMedia || typeof sectionMedia !== "object") return;
    setCurrentField("Based", sectionMedia.based);
    setCurrentField("Studying", sectionMedia.studying);
    setCurrentField("Shooting", sectionMedia.shooting);
    setCurrentField("Reading", sectionMedia.reading);

    var emailRow = Array.from(document.querySelectorAll(".ab-clink")).find(function (item) {
      var label = item.querySelector(".ab-clink-label");
      return label && String(label.textContent || "").trim().toLowerCase() === "email";
    });
    if (emailRow && sectionMedia.email) {
      var val = emailRow.querySelector(".ab-clink-val");
      if (val) val.textContent = String(sectionMedia.email);
    }
  }

  function buildFeaturedItems(featuredDoc, shoots, bySlug, byId) {
    var configured = Array.isArray(featuredDoc?.items) ? featuredDoc.items : [];
    var resolved = configured
      .map(function (item) {
        var shoot = bySlug[item?.shootSlug] || byId[item?.shootId];
        if (!shoot) return null;
        var matched = (shoot.photos || []).find(function (photo) { return photo.id === item?.photoId; }) || shoot.photos[0] || null;
        return {
          shootSlug: shoot.slug,
          title: String(item?.shootTitle || shoot.title || "Untitled shoot"),
          location: String(item?.locationLabel || matched?.location || shoot.location || ""),
          date: shoot.date,
          accent: String(item?.accentColor || shoot.accent || "#FF2D78"),
          photoUrl: String(item?.photoUrl || matched?.src || shoot.cover || ""),
          photoAlt: String(item?.photoAlt || matched?.title || shoot.title || "Featured photo"),
          width: Number.isFinite(Number(item?.width)) ? Number(item.width) : matched?.width || null,
          height: Number.isFinite(Number(item?.height)) ? Number(item.height) : matched?.height || null,
        };
      })
      .filter(Boolean);

    if (!resolved.length) {
      resolved = shoots.map(function (shoot) {
        var first = shoot.photos?.[0] || null;
        return {
          shootSlug: shoot.slug,
          title: shoot.title,
          location: shoot.location,
          date: shoot.date,
          accent: shoot.accent,
          photoUrl: first?.src || shoot.cover || "",
          photoAlt: first?.title || shoot.title || "Featured photo",
          width: first?.width || null,
          height: first?.height || null,
        };
      });
    }

    if (!resolved.length) return [];
    var padded = [];
    for (var index = 0; index < 6; index += 1) {
      padded.push(resolved[index % resolved.length]);
    }
    return padded;
  }

  function patchFeaturedSlides(items) {
    var track = document.getElementById("feat-track");
    if (!track) return;
    var controls = document.querySelector(".feat-controls");
    var progress = document.querySelector(".feat-prog");
    var mantra = document.getElementById("feat-mantra");

    if (!items.length) {
      if (controls) controls.style.display = "none";
      if (progress) progress.style.display = "none";
      if (mantra) mantra.style.display = "none";
      track.innerHTML = '' +
        '<div class="fslide active r" style="opacity:1;pointer-events:none">' +
          '<div class="fs-title-block" style="margin-left:0;box-shadow:none;width:min(680px,100%)">' +
            '<div class="fs-eyebrow">Photography</div>' +
            '<h2 class="fs-title">No published shoots yet</h2>' +
            '<span class="fs-cta" style="cursor:default;border-bottom-color:#282828;color:#888">Publish from Admin to populate this page</span>' +
          "</div>" +
        "</div>";
      applyAccent(shootAccentLock || currentAccentColor);
      return;
    }

    if (controls) controls.style.display = "";
    if (progress) progress.style.display = "";
    if (mantra) mantra.style.display = "";
    var slides = Array.from(document.querySelectorAll("#feat-track .fslide"));
    if (!slides.length) return;

    slides.forEach(function (slide, index) {
      var item = items[index % items.length];
      var isPortrait = Number.isFinite(item.width) && Number.isFinite(item.height) ? item.width < item.height : false;
      var isLeft = index % 2 === 1;

      slide.classList.remove("r", "l", "portrait");
      slide.classList.add(isLeft ? "l" : "r");
      if (isPortrait) slide.classList.add("portrait");
      slide.style.setProperty("--accent", item.accent || "#FF2D78");

      var wrap = slide.querySelector(".fs-img-wrap");
      if (wrap) {
        wrap.setAttribute("data-shoot-slug", item.shootSlug);
        wrap.onclick = function () {
          if (typeof window.showShoot === "function") window.showShoot(item.shootSlug);
        };
      }

      var image = slide.querySelector(".fs-img");
      if (image) {
        image.src = item.photoUrl || image.src;
        image.alt = item.photoAlt || item.title || "Featured photo";
      }

      var eyebrow = slide.querySelector(".fs-eyebrow");
      if (eyebrow) {
        eyebrow.textContent = [item.location, item.date].filter(Boolean).join(" · ");
      }
      var title = slide.querySelector(".fs-title");
      if (title) title.textContent = item.title || "Untitled shoot";
      var cta = slide.querySelector(".fs-cta");
      if (cta) {
        cta.setAttribute("data-shoot-slug", item.shootSlug);
        cta.onclick = function () {
          if (typeof window.showShoot === "function") window.showShoot(item.shootSlug);
        };
      }
    });

    var dots = Array.from(document.querySelectorAll(".feat-dot"));
    dots.forEach(function (dot, index) {
      dot.classList.toggle("active", index === 0);
    });
    slides.forEach(function (slide, index) {
      slide.classList.toggle("active", index === 0);
    });
    applyAccent(items[0].accent || currentAccentColor);
    setupFeaturedRotator();
  }

  function stopFeaturedRotator() {
    if (featuredRotatorState.timer) {
      clearInterval(featuredRotatorState.timer);
      featuredRotatorState.timer = null;
    }
    if (featuredRotatorState.raf) {
      cancelAnimationFrame(featuredRotatorState.raf);
      featuredRotatorState.raf = null;
    }
  }

  function setupFeaturedRotator() {
    stopFeaturedRotator();
    var slides = Array.from(document.querySelectorAll("#feat-track .fslide"));
    var dots = Array.from(document.querySelectorAll(".feat-dot"));
    var fill = document.getElementById("feat-prog-fill");
    var mantra = document.getElementById("feat-mantra");
    var words = ["mw0", "mw1", "mw2"].map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var prev = document.getElementById("feat-prev");
    var next = document.getElementById("feat-next");
    if (!slides.length || !dots.length) return;

    function paintProgress() {
      if (!fill) return;
      featuredRotatorState.raf = requestAnimationFrame(function step(now) {
        var elapsed = now - featuredRotatorState.start;
        var pct = Math.min((elapsed / featuredRotatorState.interval) * 100, 100);
        fill.style.width = pct + "%";
        if (pct < 100) paintProgress();
      });
    }

    function activate(index) {
      var previous = featuredRotatorState.index;
      if (slides[previous]) slides[previous].classList.remove("active");
      if (dots[previous]) dots[previous].classList.remove("active");
      featuredRotatorState.index = ((index % slides.length) + slides.length) % slides.length;
      var activeSlide = slides[featuredRotatorState.index];
      var activeDot = dots[featuredRotatorState.index];
      if (activeSlide) activeSlide.classList.add("active");
      if (activeDot) activeDot.classList.add("active");
      var accent = String(activeSlide?.style.getPropertyValue("--accent") || "#FF2D78").trim() || "#FF2D78";
      var indexPage = document.getElementById("page-index");
      var isIndexActive = Boolean(indexPage && indexPage.classList.contains("active"));
      if (!shootAccentLock && isIndexActive) applyAccent(accent);
      if (mantra) {
        var isLeft = activeSlide ? activeSlide.classList.contains("l") : false;
        mantra.style.right = isLeft ? "auto" : "20px";
        mantra.style.left = isLeft ? "20px" : "auto";
        mantra.style.alignItems = isLeft ? "flex-start" : "flex-end";
      }
      words.forEach(function (word, wordIndex) {
        word.style.webkitTextStroke = wordIndex === (featuredRotatorState.index % 3)
          ? "1.5px " + accent
          : "1.5px rgba(240,239,235,0.07)";
      });
      if (fill) fill.style.width = "0%";
      featuredRotatorState.start = performance.now();
      if (featuredRotatorState.raf) cancelAnimationFrame(featuredRotatorState.raf);
      paintProgress();
    }

    function restartTimer() {
      if (featuredRotatorState.timer) clearInterval(featuredRotatorState.timer);
      featuredRotatorState.timer = setInterval(function () {
        activate(featuredRotatorState.index + 1);
      }, featuredRotatorState.interval);
    }

    dots.forEach(function (dot, dotIndex) {
      dot.onclick = function () {
        activate(dotIndex);
        restartTimer();
      };
    });
    if (prev) prev.onclick = function () { activate(featuredRotatorState.index - 1); restartTimer(); };
    if (next) next.onclick = function () { activate(featuredRotatorState.index + 1); restartTimer(); };
    activate(0);
    restartTimer();
  }

  function installShootOverride() {
    var cleanup = null;
    var inspectState = null;

    function ensureInspectOverlay() {
      var overlay = document.getElementById("photo-inspect");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "photo-inspect";
        overlay.className = "photo-inspect";
        overlay.innerHTML = '' +
          '<div class="inspect-stage" id="inspect-stage">' +
            '<button class="inspect-close" id="inspect-close" type="button" aria-label="Close inspect">X</button>' +
            '<img class="inspect-img" id="inspect-img" alt="Inspect photo" />' +
          "</div>";
        document.body.appendChild(overlay);
      }
      return overlay;
    }

    function installInspectHandlers(imageEl, stageEl, closeOverlay) {
      var state = { scale: 1, minScale: 1, originX: "50%", originY: "50%" };
      function clamp() {
        state.scale = Math.max(state.minScale, Math.min(state.scale, 6));
      }
      function render() {
        imageEl.style.transformOrigin = state.originX + " " + state.originY;
        imageEl.style.transform = "scale(" + state.scale + ")";
      }
      function reset() {
        state.scale = 1;
        state.minScale = 1;
        state.originX = "50%";
        state.originY = "50%";
        render();
      }
      function onWheel(event) {
        event.preventDefault();
        var delta = event.deltaY < 0 ? 0.16 : -0.16;
        state.scale += delta;
        clamp();
        render();
      }
      function onStageClick(event) {
        if (event.target === imageEl) return;
        closeOverlay();
      }
      function onImageClick(event) {
        var rect = imageEl.getBoundingClientRect();
        var clickX = event.clientX - rect.left;
        var clickY = event.clientY - rect.top;
        if (state.scale <= 1) {
          state.originX = Math.max(0, Math.min(clickX, rect.width)) + "px";
          state.originY = Math.max(0, Math.min(clickY, rect.height)) + "px";
          state.scale = 2.5;
          state.minScale = state.scale;
        } else {
          state.scale = 1;
          state.minScale = 1;
          state.originX = "50%";
          state.originY = "50%";
        }
        render();
      }
      function onKey(event) {
        if (event.key === "Escape") closeOverlay();
      }
      stageEl.addEventListener("wheel", onWheel, { passive: false });
      stageEl.addEventListener("click", onStageClick);
      imageEl.addEventListener("click", onImageClick);
      window.addEventListener("keydown", onKey);
      return {
        reset: reset,
        destroy: function () {
          stageEl.removeEventListener("wheel", onWheel);
          stageEl.removeEventListener("click", onStageClick);
          imageEl.removeEventListener("click", onImageClick);
          window.removeEventListener("keydown", onKey);
        },
      };
    }

    function openInspect(src, alt) {
      var overlay = ensureInspectOverlay();
      var image = overlay.querySelector("#inspect-img");
      var stage = overlay.querySelector("#inspect-stage");
      var close = overlay.querySelector("#inspect-close");
      if (!image || !stage || !close) return;
      if (inspectState && typeof inspectState.destroy === "function") inspectState.destroy();
      image.src = String(src || "");
      image.alt = String(alt || "Inspect photo");
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
      function closeInspect() {
        overlay.classList.remove("open");
        document.body.style.overflow = "";
        if (inspectState && typeof inspectState.destroy === "function") inspectState.destroy();
        inspectState = null;
      }
      inspectState = installInspectHandlers(image, stage, closeInspect);
      inspectState.reset();
      close.onclick = closeInspect;
      overlay.onclick = function (event) {
        if (event.target !== overlay) return;
        closeInspect();
      };
    }

    function updateShootPanel(d, n) {
      var pc = document.getElementById("sg-pc");
      if (!pc) return;
      pc.classList.add("fading");
      setTimeout(function () {
        var cur = document.querySelector(".cnt-editorial .cur,.cnt-documentary .cur,.cnt-cinematic .cur");
        if (cur) cur.textContent = String(n + 1).padStart(2, "0");
        document.getElementById("sg-frame-title").textContent = safeDecode(d.title);
        document.getElementById("sg-caption").textContent = safeDecode(d.caption);
        document.getElementById("sg-note").textContent = safeDecode(d.quote || d.note || d.caption);
        document.getElementById("sg-location").textContent = safeDecode(d.location);
        document.getElementById("sg-date").textContent = safeDecode(d.date);
        document.getElementById("sg-camera").textContent = d.camera || "";
        document.getElementById("sg-lens").textContent = d.lens || "";
        document.getElementById("sg-shutter").textContent = d.shutter || "";
        document.getElementById("sg-aperture").textContent = d.aperture || "";
        document.getElementById("sg-iso").textContent = d.iso || "";

        var showMetadata = d.meta !== "0";
        var exifLabel = document.querySelector("#sg-pc .sg-exif-label");
        var exifGrid = document.querySelector("#sg-pc .sg-exif-grid");
        if (exifLabel) exifLabel.style.display = showMetadata ? "" : "none";
        if (exifGrid) exifGrid.style.display = showMetadata ? "flex" : "none";
        var dividers = document.querySelectorAll("#sg-pc .sg-divider");
        if (dividers[1]) dividers[1].style.display = showMetadata ? "" : "none";

        document.querySelectorAll(".pdot").forEach(function (dot, index) {
          dot.classList.toggle("active", index === n);
        });
        pc.classList.remove("fading");
      }, 160);
    }

    window.showShoot = function showShoot(slug) {
      var shoot = LIVE_SHOOTS[slug];
      if (!shoot) return;
      writeShootParam(shoot.slug);
      if (typeof cleanup === "function") {
        cleanup();
        cleanup = null;
      }

      shootAccentLock = shoot.accent || currentAccentColor;
      applyAccent(shootAccentLock);
      document.getElementById("page-shoot").style.setProperty("--a", shoot.accent || "#FF2D78");

      var photos = (Array.isArray(shoot.photos) ? shoot.photos : [])
        .map(function (photo, index) {
          var src = String(photo?.src || "").trim();
          if (!src) return null;
          return {
            idx: index,
            src: src,
            title: String(photo?.title || "Frame " + String(index + 1).padStart(2, "0")),
            caption: String(photo?.caption || ""),
            quote: String(photo?.quote || photo?.caption || ""),
            note: String(photo?.quote || photo?.caption || ""),
            location: String(photo?.location || shoot.location || ""),
            date: String(photo?.date || shoot.date || ""),
            camera: String(photo?.camera || shoot.camera || ""),
            lens: String(photo?.lens || shoot.lens || ""),
            shutter: String(photo?.shutter || ""),
            aperture: String(photo?.aperture || ""),
            iso: String(photo?.iso || ""),
            metadataEnabled: photo?.metadataEnabled !== false,
          };
        })
        .filter(Boolean);

      if (!photos.length) return;

      var tmpl = shoot.template || "editorial";
      var tFS = tmpl === "editorial" ? "clamp(64px,9vw,130px)" : tmpl === "documentary" ? "clamp(28px,4vw,56px)" : "clamp(52px,8vw,120px)";
      var tFam = tmpl === "documentary" ? "'IBM Plex Mono',monospace" : tmpl === "cinematic" ? "'Cormorant Garamond',serif" : "'Bebas Neue',sans-serif";
      var tExt = tmpl === "cinematic"
        ? "font-style:italic;font-weight:300;letter-spacing:-2px;line-height:.9"
        : tmpl === "documentary"
          ? "font-weight:500;letter-spacing:-1px;line-height:1.1"
          : "letter-spacing:-1px;line-height:.88";
      var iFam = tmpl === "documentary" ? "'IBM Plex Mono',monospace" : "'Cormorant Garamond',serif";
      var iSz = tmpl === "documentary" ? "11px" : tmpl === "cinematic" ? "22px" : "20px";
      var iIt = tmpl !== "documentary" ? "font-style:italic" : "";
      var tgSt = tmpl === "documentary"
        ? "font-family:'IBM Plex Mono',monospace;font-size:7.5px;letter-spacing:2px;text-transform:uppercase;padding:3px 10px;background:#1A1A1A;color:" + shoot.accent
        : tmpl === "cinematic"
          ? "font-family:'Cormorant Garamond',serif;font-size:12px;font-style:italic;padding:2px 10px;border-bottom:1px solid #282828;color:#505050"
          : "font-family:'IBM Plex Mono',monospace;font-size:7.5px;letter-spacing:1px;text-transform:uppercase;padding:3px 8px;border:1px solid #282828;color:#505050";

      var mantraActive = (Number(shoot.order || 1) - 1) % 3;
      var mantraWords = ["SEEN", "FELT", "KEPT"];
      var mantraHtml = mantraWords.map(function (word, index) {
        return '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:clamp(60px,8vw,110px);letter-spacing:-2px;color:transparent;-webkit-text-stroke:1.5px ' +
          (index === mantraActive ? shoot.accent : "rgba(240,239,235,.07)") +
          ';display:block">' + word + "</span>";
      }).join("");

      var photosEl = document.getElementById("sg-photos");
      var titleHtml = '' +
        '<div class="sg-tile sg-title-tile" data-is-title="1" style="position:relative;overflow:hidden">' +
          '<div style="position:absolute;right:28px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:flex-end;gap:0;pointer-events:none;z-index:0;line-height:.82">' + mantraHtml + "</div>" +
          '<div style="position:relative;z-index:1;max-width:680px">' +
            '<span data-page-target="index" style="font-family:\'IBM Plex Mono\',monospace;font-size:8.5px;letter-spacing:3px;text-transform:uppercase;color:var(--g4);cursor:pointer;margin-bottom:44px;display:inline-block;transition:color .2s" onmouseenter="this.style.color=\'#F0EFEB\'" onmouseleave="this.style.color=\'#505050\'">? Photos</span>' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:5px;text-transform:uppercase;color:' + esc(shoot.accent) + ';margin-bottom:20px">' + esc(shoot.location || "") + " · " + esc(shoot.date || "") + "</div>" +
            '<h1 style="font-family:' + tFam + ';font-size:' + tFS + ';' + tExt + ';color:#F0EFEB;margin-bottom:28px">' + esc(shoot.title || "") + "</h1>" +
            '<p style="font-family:' + iFam + ';font-size:' + iSz + ';' + iIt + ';color:#505050;line-height:1.65;max-width:560px;margin-bottom:28px">' + esc(shoot.intro || "") + "</p>" +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:36px">' + (shoot.tags || []).map(function (tag) { return '<span style="' + tgSt + '">' + esc(tag) + "</span>"; }).join("") + "</div>" +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:' + esc(shoot.accent) + ';display:flex;align-items:center;gap:12px">Scroll to enter<span style="display:block;width:1px;height:40px;background:linear-gradient(to bottom,' + esc(shoot.accent) + ',transparent)"></span></div>' +
          "</div>" +
        "</div>";

      var photoHtml = photos.map(function (photo, index) {
        return '' +
          '<div class="sg-tile sg-photo-tile' + (index % 2 === 1 ? " kb-b" : "") + '"' +
            ' data-index="' + index + '"' +
            ' data-title="' + encodeURIComponent(photo.title) + '"' +
            ' data-caption="' + encodeURIComponent(photo.caption) + '"' +
            ' data-note="' + encodeURIComponent(photo.note) + '"' +
            ' data-quote="' + encodeURIComponent(photo.quote) + '"' +
            ' data-location="' + encodeURIComponent(photo.location) + '"' +
            ' data-date="' + encodeURIComponent(photo.date) + '"' +
            ' data-camera="' + esc(photo.camera) + '"' +
            ' data-lens="' + esc(photo.lens) + '"' +
            ' data-shutter="' + esc(photo.shutter) + '"' +
            ' data-aperture="' + esc(photo.aperture) + '"' +
            ' data-iso="' + esc(photo.iso) + '"' +
            ' data-meta="' + (photo.metadataEnabled ? "1" : "0") + '">' +
            '<img src="' + esc(photo.src) + '" alt="' + esc(photo.title) + '" loading="' + (index < 2 ? "eager" : "lazy") + '"/>' +
          "</div>";
      }).join("");

      var endHtml = '' +
        '<div class="sg-tile" data-is-end="1" style="flex-direction:column">' +
          '<div style="text-align:center">' +
            '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:8.5px;letter-spacing:5px;text-transform:uppercase;color:#282828;margin-bottom:16px">End of shoot</div>' +
            '<div style="font-family:\'Bebas Neue\',sans-serif;font-size:clamp(40px,6vw,80px);color:#F0EFEB;line-height:1;margin-bottom:8px">' + esc(shoot.title || "") + "</div>" +
            '<div style="font-family:\'Cormorant Garamond\',serif;font-size:15px;font-style:italic;color:#505050;margin-bottom:44px">' + esc(String(photos.length)) + " frames · " + esc(shoot.location || "") + "</div>" +
            '<div style="display:flex;gap:12px;justify-content:center">' +
              '<button data-page-target="index" style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;padding:12px 22px;background:' + esc(shoot.accent) + ';color:#080808;border:none;cursor:pointer">&larr; All shoots</button>' +
              '<button id="sg-restart" style="font-family:\'IBM Plex Mono\',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;padding:12px 22px;background:transparent;border:1px solid #282828;color:#505050;cursor:pointer">&uarr; Back to start</button>' +
            "</div>" +
          "</div>" +
        "</div>";

      photosEl.innerHTML = '<div class="sg-scrollbar"><div class="sg-scrollbar-fill" id="sg-scrollbar-fill" style="height:0%"></div></div>' + titleHtml + photoHtml + endHtml;
      Array.from(photosEl.querySelectorAll("[data-page-target]")).forEach(function (node) {
        node.addEventListener("click", function () {
          if (typeof window.showPage !== "function") return;
          var target = String(node.getAttribute("data-page-target") || "").trim();
          if (target) window.showPage(target);
        });
      });

      var panel = document.getElementById("sg-panel");
      panel.style.borderLeft = tmpl === "documentary" ? "2px solid " + shoot.accent : "1px solid #1A1A1A";
      var counter = document.getElementById("sg-counter");
      if (tmpl === "editorial") counter.innerHTML = '<div class="cnt-editorial"><span class="cur">—</span><span class="sep">/</span><span class="tot">' + String(photos.length).padStart(2, "0") + "</span></div>";
      else if (tmpl === "documentary") counter.innerHTML = '<div class="cnt-documentary"><span class="cur">—</span><span class="sep">/</span><span class="tot">' + String(photos.length).padStart(2, "0") + "</span></div>";
      else counter.innerHTML = '<div class="cnt-cinematic"><span class="cur">—</span><span class="sep">/</span><span class="tot">' + String(photos.length).padStart(2, "0") + "</span></div>";

      document.getElementById("sg-frame-title").className = "sg-frame-title ft-" + tmpl;
      document.getElementById("sg-caption").className = "sg-caption cap-" + tmpl;

      var accentContainer = document.getElementById("sg-panel-accent");
      if (tmpl === "editorial") accentContainer.innerHTML = '<div class="panel-accent-line" style="background:' + esc(shoot.accent) + '"></div>';
      else if (tmpl === "documentary") accentContainer.innerHTML = '<div class="panel-accent-mono" style="color:' + esc(shoot.accent) + '">0110 1111 0110 0010</div>';
      else accentContainer.innerHTML = '<div class="panel-accent-dots">' + photos.map(function (_, index) { return '<span class="pdot' + (index === 0 ? " active" : "") + '" data-i="' + index + '"></span>'; }).join("") + "</div>";

      document.getElementById("mob-bar-num").style.color = shoot.accent;
      document.getElementById("mob-bar-title").style.color = shoot.accent;

      var allTiles = Array.from(photosEl.querySelectorAll(".sg-tile"));
      var total = allTiles.length;
      var current = 0;
      var snapping = false;
      var trackpadSpikeThreshold = 3;
      var wheelRateThreshold = 1.0;
      var minDeltaTrackpad = 2;
      var minDeltaWheel = 20;
      var lastWheelTs = 0;
      var lastDeltaY = 0;
      var prevRate = 0;
      var wheelDebug = false;
      try {
        wheelDebug = String(new URL(window.location.href).searchParams.get("wheelDebug") || "") === "1";
      } catch {
        wheelDebug = false;
      }
      function logWheel(reason, extra) {
        if (!wheelDebug) return;
        var payload = Object.assign({ reason: reason }, extra || {});
        console.log("[photo-wheel]", payload);
      }
      function isLikelyTrackpad(event) {
        // Trackpads usually emit pixel-mode wheel deltas with relatively small increments.
        return event.deltaMode === 0 && Math.abs(event.deltaY) < 60;
      }
      function restartKB(tile) {
        return;
      }

      function positionTiles(index, animate) {
        allTiles.forEach(function (tile, tileIndex) {
          tile.style.transition = animate ? "transform .62s cubic-bezier(.77,0,.18,1),opacity .45s ease" : "none";
          if (tileIndex === index) {
            tile.style.transform = "translateY(0)";
            tile.style.opacity = "1";
            tile.style.zIndex = "2";
            if (!tile.dataset.isTitle && !tile.dataset.isEnd) restartKB(tile);
          } else if (tileIndex < index) {
            tile.style.transform = "translateY(-100%)";
            tile.style.opacity = "0";
            tile.style.zIndex = "1";
          } else {
            tile.style.transform = "translateY(100%)";
            tile.style.opacity = "0";
            tile.style.zIndex = "1";
          }
        });

        var progress = total > 1 ? (index / (total - 1)) * 100 : 0;
        var fill = document.getElementById("sg-scrollbar-fill");
        if (fill) fill.style.height = progress + "%";

        var tile = allTiles[index];
        var isPhoto = !tile.dataset.isTitle && !tile.dataset.isEnd;
        document.getElementById("sg-pc").style.opacity = isPhoto ? "1" : "0.12";
        document.getElementById("sg-counter").style.opacity = isPhoto ? "1" : "0";
        if (isPhoto) {
          var data = tile.dataset;
          var photoIndex = parseInt(data.index, 10);
          updateShootPanel(data, photoIndex);
          document.getElementById("mob-bar-num").textContent = String(photoIndex + 1).padStart(2, "0");
          document.getElementById("mob-bar-title").textContent = safeDecode(data.title);
          if (window.innerWidth <= 768) document.getElementById("mob-bar").style.display = "flex";
        } else if (window.innerWidth <= 768) {
          document.getElementById("mob-bar").style.display = tile.dataset.isTitle ? "none" : "flex";
          if (tile.dataset.isEnd) {
            document.getElementById("mob-bar-num").textContent = "";
            document.getElementById("mob-bar-title").textContent = "End of shoot";
          }
        }
      }

      function snapTo(index, animate) {
        if (snapping) return;
        var next = Math.max(0, Math.min(index, total - 1));
        if (next === current) {
          snapping = false;
          return;
        }
        if (!allTiles[next].dataset.isTitle && !allTiles[next].dataset.isEnd && typeof window.playShutter === "function") {
          window.playShutter();
        }
        snapping = true;
        current = next;
        positionTiles(current, animate !== false);
        window.setTimeout(function () {
          snapping = false;
        }, 700);
      }

      positionTiles(0, false);

      function onWheel(event) {
        event.preventDefault();
        if (snapping) return;

        var now = performance.now();
        var dt = Math.max(1, now - (lastWheelTs || now));
        var deltaY = event.deltaY;
        var absDelta = Math.abs(deltaY);
        var rate = absDelta / dt;
        var trackpad = isLikelyTrackpad(event);
        var minDelta = trackpad ? minDeltaTrackpad : minDeltaWheel;

        logWheel("wheel", {
          dt: Number(dt.toFixed(2)),
          rate: Number(rate.toFixed(3)),
          prevRate: Number(prevRate.toFixed(3)),
          trackpad: trackpad,
        });

        if (trackpad) {
          if (absDelta >= minDelta && prevRate <= trackpadSpikeThreshold && rate > trackpadSpikeThreshold) {
            if (deltaY > 0) {
              logWheel("snap-next", { mode: "trackpad-derivative", threshold: trackpadSpikeThreshold });
              snapTo(current + 1, true);
            } else if (deltaY < 0) {
              logWheel("snap-prev", { mode: "trackpad-derivative", threshold: trackpadSpikeThreshold });
              snapTo(current - 1, true);
            }
          }
        } else if (absDelta >= minDelta && prevRate <= wheelRateThreshold && rate > wheelRateThreshold) {
          if (deltaY > 0) {
            logWheel("snap-next", { mode: "wheel-derivative", threshold: wheelRateThreshold });
            snapTo(current + 1, true);
          } else if (deltaY < 0) {
            logWheel("snap-prev", { mode: "wheel-derivative", threshold: wheelRateThreshold });
            snapTo(current - 1, true);
          }
        }

        lastWheelTs = now;
        lastDeltaY = deltaY;
        prevRate = rate;
      }

      var touchStartY = null;
      var touchMoved = false;
      function onTouchStart(event) {
        touchStartY = event.touches[0].clientY;
        touchMoved = false;
      }
      function onTouchMove() {
        touchMoved = true;
      }
      function onTouchEnd(event) {
        if (touchStartY === null) return;
        var deltaY = touchStartY - event.changedTouches[0].clientY;
        if (touchMoved && Math.abs(deltaY) > 55) {
          snapTo(deltaY > 0 ? current + 1 : current - 1, true);
        }
        touchStartY = null;
        touchMoved = false;
      }
      function onKey(event) {
        var shootPage = document.getElementById("page-shoot");
        if (!shootPage || !shootPage.classList.contains("active")) return;
        if (event.key === "Escape") {
          var inspectOverlay = document.getElementById("photo-inspect");
          if (inspectOverlay && inspectOverlay.classList.contains("open")) {
            var inspectClose = inspectOverlay.querySelector("#inspect-close");
            if (inspectClose) inspectClose.click();
            return;
          }
        }
        if (event.key === "ArrowDown" || event.key === "ArrowRight") snapTo(current + 1, true);
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") snapTo(current - 1, true);
        if (event.key === "Escape" && typeof window.showPage === "function") window.showPage("index");
      }

      photosEl.addEventListener("wheel", onWheel, { passive: false });
      photosEl.addEventListener("touchstart", onTouchStart, { passive: true });
      photosEl.addEventListener("touchmove", onTouchMove, { passive: true });
      photosEl.addEventListener("touchend", onTouchEnd, { passive: true });
      window.addEventListener("keydown", onKey);
      var restart = document.getElementById("sg-restart");
      if (restart) restart.addEventListener("click", function () { snapTo(0, true); });
      Array.from(document.querySelectorAll(".pdot")).forEach(function (dot) {
        dot.style.cursor = "pointer";
        dot.addEventListener("click", function () {
          var target = parseInt(dot.getAttribute("data-i") || "-1", 10);
          if (!Number.isFinite(target) || target < 0) return;
          snapTo(target + 1, true);
        });
      });
      Array.from(photosEl.querySelectorAll(".sg-photo-tile img")).forEach(function (img) {
        img.addEventListener("click", function () {
          openInspect(img.getAttribute("src") || "", img.getAttribute("alt") || "");
        });
      });

      cleanup = function () {
        photosEl.removeEventListener("wheel", onWheel);
        photosEl.removeEventListener("touchstart", onTouchStart);
        photosEl.removeEventListener("touchmove", onTouchMove);
        photosEl.removeEventListener("touchend", onTouchEnd);
        window.removeEventListener("keydown", onKey);
      };

      if (typeof window.showPage === "function") window.showPage("shoot");
    };
  }

  async function boot() {
    installRuntimeGlobals();
    installPageRouter();
    installShootOverride();
    var config = readJsonScript("photography-public-firestore-config", {});
    if (!window.SFAPublicFirestore || !config.projectId || !config.apiKey) {
      applyEmptyState("Photography content is unavailable right now.");
      return;
    }

    try {
      var results = await Promise.all([
        window.SFAPublicFirestore.getDocument(config, "site_config/photography_featured"),
        window.SFAPublicFirestore.listCollection(config, "photo_shoots"),
        window.SFAPublicFirestore.getDocument(config, "site_config/section_media"),
      ]);

      var featuredDoc = results[0] || { items: [] };
      var rawShoots = Array.isArray(results[1]) ? results[1] : [];
      var sectionMedia = results[2] || {};
      var previewShoot = readAdminPreviewShoot();
      if (previewShoot) {
        rawShoots = [previewShoot].concat(rawShoots.filter(function (shoot) {
          return String(shoot?.slug || "") !== String(previewShoot.slug || "")
            && String(shoot?.id || "") !== String(previewShoot.id || "");
        }));
      }

      var sortedRaw = rawShoots.slice().sort(function (left, right) {
        return (toDate(right?.shootDate)?.getTime() || 0) - (toDate(left?.shootDate)?.getTime() || 0);
      });

      var shoots = sortedRaw
        .map(function (rawShoot, index) { return normalizeShoot(rawShoot, index + 1); })
        .filter(Boolean);

      patchAboutAdminInfo(sectionMedia);
      if (!shoots.length) {
        applyEmptyState("No photography shoots have been published yet.");
        return;
      }

      var bySlug = Object.fromEntries(shoots.map(function (shoot) { return [shoot.slug, shoot]; }));
      var byId = Object.fromEntries(shoots.map(function (shoot) { return [shoot.id, shoot]; }));

      replaceShootsRegistry(shoots);
      patchArchiveGrid(shoots);
      patchAboutRecent(shoots);

      var featured = buildFeaturedItems(featuredDoc, shoots, bySlug, byId);
      patchFeaturedSlides(featured);

      var requestedShoot = "";
      try {
        requestedShoot = String(new URL(window.location.href).searchParams.get("shoot") || "").trim();
      } catch {
        requestedShoot = "";
      }
      if (requestedShoot && bySlug[requestedShoot] && typeof window.showShoot === "function") {
        window.showShoot(requestedShoot);
      } else if (requestedShoot && !bySlug[requestedShoot]) {
        writeShootParam("");
      }
      document.body.classList.remove("photo-loading");
    } catch (error) {
      applyEmptyState("Photography content could not be loaded right now.");
      console.warn("Photography live integration failed.", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();




