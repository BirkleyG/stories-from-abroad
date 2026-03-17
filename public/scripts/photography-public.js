(function () {
  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatDate(value) {
    if (!value) return "Undated";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function buildShootPath(basePath, slug) {
    return slug ? basePath + "photography/" + encodeURIComponent(slug) + "/" : basePath + "photography/";
  }

  function resolveRequestedSlug(basePath) {
    try {
      var url = new URL(window.location.href);
      var querySlug = String(url.searchParams.get("shoot") || "").trim();
      if (querySlug) return decodeURIComponent(querySlug);
      var base = String(basePath || "/");
      var pathname = String(url.pathname || "");
      var normalizedBase = base.endsWith("/") ? base : base + "/";
      if (!pathname.startsWith(normalizedBase)) return "";
      var relative = pathname.slice(normalizedBase.length);
      if (relative.indexOf("photography/") !== 0) return "";
      var parts = relative.split("/").filter(Boolean);
      return parts.length >= 2 ? decodeURIComponent(parts[1]) : "";
    } catch (error) {
      return "";
    }
  }

  function sortShoots(shoots) {
    return (shoots || []).slice().sort(function (left, right) {
      return new Date(right.shootDate || 0).getTime() - new Date(left.shootDate || 0).getTime();
    });
  }

  function flattenFallbackFeatured(shoots) {
    return shoots.slice(0, 4).map(function (shoot) {
      var photo = shoot.coverPhoto || (shoot.allPhotos || [])[0] || null;
      if (!photo) return null;
      return {
        shootId: shoot.id,
        shootSlug: shoot.slug,
        shootTitle: shoot.title,
        photoId: photo.id || "cover",
        photoUrl: photo.url,
        photoAlt: photo.alt || shoot.title || "Featured photograph",
        caption: photo.caption || shoot.subtitle || "",
        locationLabel: photo.locationLabel || shoot.locationLabel || "",
        accentColor: shoot.accentColor || "#c96b28",
      };
    }).filter(Boolean);
  }

  function renderArchive(state, copy) {
    var featuredItems = (state.featured && state.featured.length ? state.featured : flattenFallbackFeatured(state.shoots));
    var featuredEl = byId("photography-featured-list");
    var cardsEl = byId("photography-shoot-grid");
    if (featuredEl) {
      if (!featuredItems.length) {
        featuredEl.innerHTML = '<p class="photo-empty">No featured photography yet.</p>';
      } else {
        featuredEl.innerHTML = featuredItems.map(function (item, index) {
          return '' +
            '<a class="photo-feature-card" href="' + esc(buildShootPath(state.basePath, item.shootSlug)) + '" data-shoot-open="' + esc(item.shootSlug) + '" style="--shoot-accent:' + esc(item.accentColor || '#c96b28') + '">' +
              '<img src="' + esc(item.photoUrl) + '" alt="' + esc(item.photoAlt || item.shootTitle || 'Featured photograph') + '" loading="lazy">' +
              '<div class="photo-feature-meta">' +
                '<span>' + esc(String(index + 1).padStart(2, '0')) + '</span>' +
                '<strong>' + esc(item.shootTitle || 'Untitled shoot') + '</strong>' +
                '<p>' + esc(item.locationLabel || item.caption || '') + '</p>' +
              '</div>' +
            '</a>';
        }).join("");
      }
    }

    if (cardsEl) {
      if (!state.shoots.length) {
        cardsEl.innerHTML = '<p class="photo-empty">No published shoots yet.</p>';
      } else {
        cardsEl.innerHTML = state.shoots.map(function (shoot) {
          var cover = shoot.coverPhoto || (shoot.allPhotos || [])[0] || null;
          return '' +
            '<a class="photo-shoot-card" href="' + esc(buildShootPath(state.basePath, shoot.slug)) + '" data-shoot-open="' + esc(shoot.slug) + '" style="--shoot-accent:' + esc(shoot.accentColor || '#c96b28') + '">' +
              (cover ? '<div class="photo-shoot-cover"><img src="' + esc(cover.url) + '" alt="' + esc(cover.alt || shoot.title || 'Shoot cover') + '" loading="lazy"></div>' : '<div class="photo-shoot-cover is-empty"></div>') +
              '<div class="photo-shoot-body">' +
                '<div class="photo-shoot-top"><span>' + esc(formatDate(shoot.shootDate)) + '</span><span>' + esc(String(shoot.frameCount || (shoot.allPhotos || []).length || 0)) + ' frames</span></div>' +
                '<h3>' + esc(shoot.title || 'Untitled shoot') + '</h3>' +
                '<p>' + esc(shoot.subtitle || shoot.notes || '') + '</p>' +
                '<div class="photo-chip-row">' +
                  '<span class="photo-chip">' + esc(shoot.descriptor || 'Shoot') + '</span>' +
                  '<span class="photo-chip">' + esc(shoot.template || 'template') + '</span>' +
                  '<span class="photo-chip">' + esc(shoot.locationLabel || '') + '</span>' +
                '</div>' +
              '</div>' +
            '</a>';
        }).join("");
      }
    }

    var heroCount = byId("photography-count");
    if (heroCount) heroCount.textContent = String(state.shoots.length);
    var frameCount = byId("photography-frame-count");
    if (frameCount) {
      var frames = state.shoots.reduce(function (total, shoot) {
        return total + Number(shoot.frameCount || (shoot.allPhotos || []).length || 0);
      }, 0);
      frameCount.textContent = String(frames);
    }
    var locationCount = byId("photography-location-count");
    if (locationCount) {
      var locations = new Set(state.shoots.map(function (shoot) { return String(shoot.locationLabel || "").trim(); }).filter(Boolean));
      locationCount.textContent = String(locations.size);
    }
    var status = byId("photography-status");
    if (status) status.textContent = state.loading ? copy.loading : "";
  }

  function renderViewer(state, shoot) {
    var root = byId("photography-shoot-view");
    var archive = byId("photography-archive-view");
    if (!root || !archive) return;
    archive.hidden = true;
    root.hidden = false;
    root.dataset.template = shoot.template || "desert-bloom";

    byId("shoot-overlay-eyebrow").textContent = shoot.locationLabel || "Published shoot";
    byId("shoot-overlay-title").textContent = shoot.title || "Untitled shoot";
    byId("shoot-overlay-subtitle").textContent = shoot.subtitle || shoot.notes || "";
    byId("shoot-overlay-meta").textContent = [formatDate(shoot.shootDate), String(shoot.frameCount || (shoot.allPhotos || []).length || 0) + " frames", shoot.cameraModel || "Unknown camera"].filter(Boolean).join(" | ");
    byId("shoot-bar-name").textContent = shoot.title || "Untitled shoot";
    byId("shoot-bar-meta").textContent = [shoot.locationLabel || "", String(shoot.frameCount || 0) + " frames"].filter(Boolean).join(" | ");
    byId("shoot-footer-title").textContent = shoot.title || "Untitled shoot";
    byId("shoot-footer-meta").textContent = [formatDate(shoot.shootDate), shoot.cameraModel || "Unknown camera", shoot.locationLabel || ""].filter(Boolean).join(" | ");

    var heroPhoto = shoot.coverPhoto || (shoot.allPhotos || [])[0] || null;
    var heroEl = byId("shoot-hero-media");
    heroEl.innerHTML = heroPhoto ? '<img src="' + esc(heroPhoto.url) + '" alt="' + esc(heroPhoto.alt || shoot.title || 'Shoot cover') + '">' : '<div class="photo-empty">No hero image</div>';

    var blocksEl = byId("shoot-blocks");
    blocksEl.innerHTML = (shoot.blocks || []).map(function (block) {
      if (block.type === "text-note") {
        return '<article class="shoot-note"><span>' + esc(block.noteLabel || 'Field Note') + '</span><h3>' + esc(block.title || 'Field note') + '</h3><p>' + esc(block.text || '') + '</p></article>';
      }
      if (block.type === "section-title") {
        return '<article class="shoot-section-title"><span>' + esc(block.tag || '') + '</span><h3>' + esc(block.title || 'Section') + '</h3><p>' + esc(block.rightNote || '') + '</p></article>';
      }
      if (block.type === "hero-photo" || block.type === "full-photo") {
        var photo = block.photo || null;
        if (!photo || !photo.url) return '';
        return '<figure class="shoot-single-frame" data-photo-open="' + esc((photo.id || block.id || '') + '') + '" data-photo-ref="' + esc(block.id + '-0') + '" style="--frame-height:' + esc(String(block.height || 780)) + 'px">' +
          '<img src="' + esc(photo.url) + '" alt="' + esc(photo.alt || shoot.title || 'Photograph') + '" loading="lazy">' +
          '<figcaption><strong>' + esc(photo.caption || photo.title || '') + '</strong><span>' + esc(photo.locationLabel || '') + '</span></figcaption>' +
        '</figure>';
      }
      var rowClass = block.type === 'ghost-text-row' ? 'shoot-photo-row ghost' : 'shoot-photo-row';
      var ghost = block.type === 'ghost-text-row' && block.ghostText ? '<div class="shoot-ghost-text ' + esc(block.ghostPosition || 'center') + '">' + esc(block.ghostText) + '</div>' : '';
      return '<section class="' + rowClass + '" style="--row-height:' + esc(String(block.height || 540)) + 'px">' + ghost + (block.photos || []).map(function (photo, index) {
        return '<figure class="shoot-row-frame" data-photo-open="' + esc(photo.id || '') + '" data-photo-ref="' + esc(block.id + '-' + index) + '">' +
          '<img src="' + esc(photo.url) + '" alt="' + esc(photo.alt || shoot.title || 'Photograph') + '" loading="lazy">' +
          '<figcaption><strong>' + esc(photo.caption || photo.title || '') + '</strong><span>' + esc(photo.locationLabel || '') + '</span></figcaption>' +
        '</figure>';
      }).join('') + '</section>';
    }).join('');

    state.currentShoot = shoot;
    state.currentPhotoIndex = 0;
    document.body.classList.add("is-photo-viewing");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderArchiveOnly() {
    var root = byId("photography-shoot-view");
    var archive = byId("photography-archive-view");
    if (!root || !archive) return;
    root.hidden = true;
    archive.hidden = false;
    document.body.classList.remove("is-photo-viewing");
  }

  function openLightbox(state, photoRef) {
    if (!state.currentShoot) return;
    var photos = state.currentShoot.allPhotos || [];
    var index = photos.findIndex(function (photo) { return photo.id === photoRef; });
    if (index < 0) return;
    state.currentPhotoIndex = index;
    updateLightbox(state);
    byId("photo-lightbox").classList.add("open");
    document.body.classList.add("is-lightbox-open");
  }

  function updateLightbox(state) {
    var photo = (state.currentShoot?.allPhotos || [])[state.currentPhotoIndex];
    if (!photo) return;
    byId("lightbox-image").src = photo.url;
    byId("lightbox-image").alt = photo.alt || state.currentShoot.title || "Photograph";
    byId("lightbox-location").textContent = [photo.locationLabel || state.currentShoot.locationLabel || '', formatDate(photo.exifDate || state.currentShoot.shootDate)].filter(Boolean).join(' | ');
    byId("lightbox-caption").textContent = photo.caption || photo.title || state.currentShoot.title || '';
    byId("lightbox-counter").textContent = String(state.currentPhotoIndex + 1) + ' / ' + String((state.currentShoot.allPhotos || []).length);
    byId("lightbox-meta").innerHTML = [
      ['Camera', photo.cameraModel || state.currentShoot.cameraModel || 'Unknown'],
      ['Dimensions', photo.width && photo.height ? photo.width + ' x ' + photo.height : 'Unknown'],
      ['File', photo.fileName || 'Unknown'],
      ['Location', photo.locationLabel || state.currentShoot.locationLabel || 'Unknown'],
    ].map(function (pair) {
      return '<div><dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd></div>';
    }).join('');
  }

  function closeLightbox() {
    byId("photo-lightbox").classList.remove("open");
    document.body.classList.remove("is-lightbox-open");
  }

  function moveLightbox(state, direction) {
    if (!state.currentShoot) return;
    var total = (state.currentShoot.allPhotos || []).length;
    if (!total) return;
    state.currentPhotoIndex = (state.currentPhotoIndex + direction + total) % total;
    updateLightbox(state);
  }

  window.SFAPhotographyPublic = {
    boot: async function boot(options) {
      var state = {
        shoots: [],
        featured: [],
        currentShoot: null,
        currentPhotoIndex: 0,
        basePath: options.basePath || '/',
        loading: true,
      };
      try {
        var results = await Promise.all([
          window.SFAPublicFirestore.getDocument(options.firestoreConfig, 'site_config/photography_featured'),
          window.SFAPublicFirestore.listCollection(options.firestoreConfig, 'photo_shoots'),
        ]);
        state.featured = Array.isArray(results[0]?.items) ? results[0].items : [];
        state.shoots = sortShoots(results[1] || []);
      } catch (error) {
        console.warn('Photography public load failed.', error);
      } finally {
        state.loading = false;
      }

      renderArchive(state, options.copy || { loading: '' });

      document.addEventListener('click', function (event) {
        var openTarget = event.target.closest('[data-shoot-open]');
        if (openTarget) {
          event.preventDefault();
          var slug = openTarget.getAttribute('data-shoot-open');
          var shoot = state.shoots.find(function (item) { return item.slug === slug; });
          if (!shoot) return;
          renderViewer(state, shoot);
          window.history.pushState({ shoot: slug }, '', buildShootPath(state.basePath, slug));
          return;
        }
        if (event.target.closest('[data-photo-lightbox-close]')) {
          closeLightbox();
          return;
        }
        var photoTarget = event.target.closest('[data-photo-ref]');
        if (photoTarget) {
          event.preventDefault();
          openLightbox(state, photoTarget.getAttribute('data-photo-ref'));
          return;
        }
        if (event.target === byId('photo-lightbox')) {
          closeLightbox();
        }
        if (event.target.closest('[data-shoot-back]')) {
          event.preventDefault();
          renderArchiveOnly();
          state.currentShoot = null;
          window.history.pushState({}, '', buildShootPath(state.basePath, ''));
        }
      });

      window.addEventListener('popstate', function () {
        var slug = resolveRequestedSlug(state.basePath);
        if (!slug) {
          renderArchiveOnly();
          state.currentShoot = null;
          return;
        }
        var shoot = state.shoots.find(function (item) { return item.slug === slug; });
        if (!shoot) {
          renderArchiveOnly();
          return;
        }
        renderViewer(state, shoot);
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          if (byId('photo-lightbox').classList.contains('open')) {
            closeLightbox();
            return;
          }
          if (state.currentShoot) {
            renderArchiveOnly();
            state.currentShoot = null;
            window.history.pushState({}, '', buildShootPath(state.basePath, ''));
          }
        }
        if (event.key === 'ArrowRight' && byId('photo-lightbox').classList.contains('open')) moveLightbox(state, 1);
        if (event.key === 'ArrowLeft' && byId('photo-lightbox').classList.contains('open')) moveLightbox(state, -1);
      });

      byId('lightbox-prev').addEventListener('click', function () { moveLightbox(state, -1); });
      byId('lightbox-next').addEventListener('click', function () { moveLightbox(state, 1); });

      window.addEventListener('scroll', function () {
        var bar = byId('shoot-title-bar');
        if (!bar || !state.currentShoot) return;
        bar.classList.toggle('visible', window.scrollY > 260);
      }, { passive: true });

      var requestedSlug = resolveRequestedSlug(state.basePath);
      if (requestedSlug) {
        var requested = state.shoots.find(function (item) { return item.slug === requestedSlug; });
        if (requested) renderViewer(state, requested);
      }
    },
  };
})();
