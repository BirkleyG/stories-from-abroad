import { collection, getDocs } from "firebase/firestore";
import { db, firestoreReady } from "../lib/firebaseClient";
import { loadSectionMediaConfig } from "../lib/siteSectionMedia";

function readCopy() {
  const el = document.getElementById("papers-copy");
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "{}");
  } catch (error) {
    console.warn("Selected Papers copy JSON could not be parsed.", error);
    return null;
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => (
    char === "&" ? "&amp;"
      : char === "<" ? "&lt;"
        : char === ">" ? "&gt;"
          : char === "\"" ? "&quot;"
            : "&#39;"
  ));
}

function sortPapers(list) {
  return [...list].sort((a, b) => {
    const featuredDelta = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    if (featuredDelta) return featuredDelta;
    const aDate = Date.parse(a.date || `${a.year || 0}-01-01`) || 0;
    const bDate = Date.parse(b.date || `${b.year || 0}-01-01`) || 0;
    if (bDate !== aDate) return bDate - aDate;
    return String(a.title).localeCompare(String(b.title));
  });
}

function normalizePaper(copy, paper, index) {
  const keywords = Array.isArray(paper.keywords)
    ? paper.keywords
    : Array.isArray(paper.kw)
      ? paper.kw
      : Array.isArray(paper.tags)
        ? paper.tags
        : [];
  const bodyText = typeof paper.bodyText === "string"
    ? paper.bodyText
    : typeof paper.fullText === "string"
      ? paper.fullText
      : "";

  return {
    id: paper.id ?? `paper-${index}`,
    title: paper.title ?? copy.defaults.title,
    subtitle: paper.subtitle ?? "",
    cat: paper.category ?? paper.cat ?? copy.defaults.category,
    year: Number(paper.year) || new Date().getFullYear(),
    date: paper.date ?? "",
    kw: keywords,
    time: paper.readTime ?? paper.time ?? copy.defaults.time,
    type: paper.type ?? copy.defaults.type,
    featured: Boolean(paper.featured),
    featuredRank: String(paper.featuredRank ?? "").trim() !== "" && Number.isFinite(Number(paper.featuredRank))
      ? Number(paper.featuredRank)
      : Number.MAX_SAFE_INTEGER,
    summary: paper.summary ?? "",
    bodyText,
    publicationName: paper.publicationName ?? "",
    publicationLink: paper.publicationLink ?? "",
    badgeStyle: paper.badgeStyle ?? paper.category ?? paper.cat ?? copy.defaults.category,
    documentUrl: paper.documentUrl ?? "",
    documentName: paper.documentName ?? "",
    externalPublication: Boolean(paper.externalPublication),
  };
}

async function loadPapers(copy) {
  if (!firestoreReady || !db) return [];
  try {
    const snap = await getDocs(collection(db, "papers"));
    const papers = snap.docs.map((doc, index) => normalizePaper(copy, { id: doc.id, ...doc.data() }, index));
    return sortPapers(papers);
  } catch (error) {
    console.warn("Firestore papers load failed.", error);
    return [];
  }
}

function applySectionMedia(config) {
  const hero = document.getElementById("papers-hero-media");
  const authorPortrait = document.getElementById("papers-author-portrait");
  if (hero && config?.papersHeroImage?.url) {
    hero.classList.remove("is-empty");
    hero.innerHTML = `<img src="${config.papersHeroImage.url}" alt="${esc(config.papersHeroImage.alt || "Selected Papers hero image")}" loading="lazy" />`;
  }
  if (authorPortrait && config?.papersAuthorPortrait?.url) {
    authorPortrait.outerHTML = `<img id="papers-author-portrait" src="${config.papersAuthorPortrait.url}" alt="${esc(config.papersAuthorPortrait.alt || "Author portrait")}" loading="lazy" />`;
  }
}

function initTypewriter(copy) {
  const lines = copy.typewriterLines || [];
  const twEl = document.getElementById("tw-el");
  if (!twEl || !lines.length) return;
  let lineIndex = 0;
  let charIndex = 0;
  let deleting = false;
  twEl.textContent = lines[0];
  function tick() {
    const line = lines[lineIndex];
    if (!deleting) {
      twEl.textContent = line.slice(0, ++charIndex);
      if (charIndex === line.length) {
        deleting = true;
        setTimeout(tick, 2800);
        return;
      }
    } else {
      twEl.textContent = line.slice(0, --charIndex);
      if (charIndex === 0) {
        deleting = false;
        lineIndex = (lineIndex + 1) % lines.length;
      }
    }
    setTimeout(tick, deleting ? 14 : 46);
  }
  setTimeout(tick, 1400);
}

function initSelectedPapersPage() {
  const copy = readCopy();
  if (!copy) return;

  const state = {
    papers: [],
    featured: [],
    featIdx: 0,
    autoTimer: null,
  };

  const counterTemplate = copy.featured.counterTemplate;
  const formatCounter = (current, total) => counterTemplate.replace("{current}", current).replace("{total}", total);
  const citStyles = copy.overlay.citationStyles;

  function triggerFeatAnim() {
    const blendEls = document.querySelectorAll(".feat-kicker,.feat-title,.feat-summary,.feat-kws,.feat-meta,.btn-read");
    blendEls.forEach((el) => { el.style.animation = "none"; });
    const featContent = document.getElementById("feat-content");
    if (featContent) void featContent.offsetWidth;
    blendEls.forEach((el) => { el.style.animation = ""; });
  }

  function setFeaturedEmpty() {
    const title = document.getElementById("feat-title");
    document.getElementById("feat-kicker").textContent = "Published Writing";
    title.textContent = "No published papers yet";
    title.onclick = null;
    document.getElementById("feat-summary").textContent = "Published papers will appear here as soon as they are live in Firestore.";
    document.getElementById("feat-kws").innerHTML = "";
    document.getElementById("feat-meta").innerHTML = "";
    document.getElementById("feat-ghost").textContent = "00";
    document.getElementById("feat-dots").innerHTML = "";
    const button = document.getElementById("feat-btn");
    button.textContent = "Awaiting Publication";
    button.disabled = true;
    const counter = document.getElementById("feat-ctr-sd");
    if (counter) counter.textContent = formatCounter("00", "00");
  }

  function updateFeat(idx) {
    const paper = state.featured[idx];
    if (!paper) {
      setFeaturedEmpty();
      return;
    }
    const title = document.getElementById("feat-title");
    document.getElementById("feat-kicker").textContent = paper.cat;
    title.textContent = paper.title;
    title.onclick = () => openPaper(paper.id);
    document.getElementById("feat-summary").textContent = paper.summary;
    document.getElementById("feat-kws").innerHTML = paper.kw.map((keyword) => `<span class="feat-kw">${esc(keyword)}</span>`).join("");
    document.getElementById("feat-meta").innerHTML = `
      <span>${esc(paper.date || paper.year)}</span>
      <span class="feat-meta-dot"></span>
      <span>${esc(paper.time)}${esc(copy.featured.metaReadSuffix)}</span>
      <span class="feat-meta-dot"></span>
      <span>${esc(paper.type)}</span>`;
    const button = document.getElementById("feat-btn");
    button.textContent = copy.featured.button;
    button.disabled = false;
    button.onclick = () => openPaper(paper.id);
    document.getElementById("feat-ghost").textContent = String(idx + 1).padStart(2, "0");
    const counter = document.getElementById("feat-ctr-sd");
    if (counter) {
      counter.textContent = formatCounter(String(idx + 1).padStart(2, "0"), String(state.featured.length).padStart(2, "0"));
    }
    document.querySelectorAll(".feat-dot").forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === idx));
    triggerFeatAnim();
  }

  function buildFeatDots() {
    document.getElementById("feat-dots").innerHTML = state.featured
      .map((_, index) => `<div class="feat-dot${index === 0 ? " active" : ""}" data-feat-index="${index}"></div>`)
      .join("");
    document.querySelectorAll("[data-feat-index]").forEach((dot) => {
      dot.addEventListener("click", () => goFeat(Number(dot.getAttribute("data-feat-index") || 0)));
    });
  }

  function goFeat(newIdx) {
    const max = state.featured.length;
    if (!max) return;
    newIdx = ((newIdx % max) + max) % max;
    if (newIdx === state.featIdx) return;
    state.featIdx = newIdx;
    updateFeat(state.featIdx);
    resetAutoTimer();
  }

  function moveFeat(dir) {
    goFeat(state.featIdx + dir);
  }

  function resetAutoTimer() {
    clearInterval(state.autoTimer);
    if (state.featured.length < 2) return;
    state.autoTimer = setInterval(() => goFeat(state.featIdx + 1), 8000);
  }

  function buildList(list) {
    const listEl = document.getElementById("papers-list");
    document.getElementById("paper-count").textContent = `${list.length} ${list.length !== 1 ? copy.archive.countPlural : copy.archive.countSingular}`;
    listEl.innerHTML = "";
    if (!list.length) {
      listEl.innerHTML = `<div class="no-results">${copy.archive.emptyState}</div>`;
      return;
    }
    list.forEach((paper, index) => {
      const row = document.createElement("div");
      row.className = "paper-row";
      row.onclick = () => openPaper(paper.id);
      row.innerHTML = `
        <div class="row-n">${String(index + 1).padStart(2, "0")}</div>
        <div class="row-body">
          <div class="row-cat">${esc(paper.cat)}</div>
          <div class="row-title">${esc(paper.title)}</div>
          <div class="row-kws">${paper.kw.map((keyword) => `<span class="row-kw">${esc(keyword)}</span>`).join("")}</div>
          <div class="row-preview">${esc(paper.summary)}</div>
        </div>
        <div class="row-aside">
          <div class="row-date">${esc(paper.date || paper.year)}</div>
          <div class="row-time">${esc(paper.time)}${esc(copy.archive.readSuffix)}</div>
          <div class="row-arrow">&rarr;</div>
        </div>`;
      listEl.appendChild(row);
    });
  }

  function fillSelect(id, label, items) {
    const select = document.getElementById(id);
    select.innerHTML = `<option value="">${esc(label)}</option>${items.map((item) => `<option>${esc(item)}</option>`).join("")}`;
  }

  function populateFilters(list) {
    fillSelect("f-cat", copy.archive.filters.categories, Array.from(new Set(list.map((paper) => paper.cat).filter(Boolean))).sort());
    fillSelect("f-yr", copy.archive.filters.years, Array.from(new Set(list.map((paper) => paper.year).filter(Boolean))).sort((a, b) => b - a));
    fillSelect("f-tp", copy.archive.filters.type, Array.from(new Set(list.map((paper) => paper.type).filter(Boolean))).sort());
  }

  function doFilter() {
    const q = document.getElementById("s-in").value.toLowerCase();
    const cat = document.getElementById("f-cat").value;
    const yr = document.getElementById("f-yr").value;
    const tp = document.getElementById("f-tp").value;
    buildList(state.papers.filter((paper) => {
      const matchesText = !q || [paper.title, paper.summary, ...paper.kw, paper.cat].some((value) => String(value).toLowerCase().includes(q));
      return matchesText && (!cat || paper.cat === cat) && (!yr || paper.year === Number(yr)) && (!tp || paper.type === tp);
    }));
  }

  function cite(paper, style) {
    const title = esc(paper.title);
    const year = esc(paper.year);
    const date = esc(paper.date || String(paper.year));
    const source = esc(paper.publicationName || copy.overlay.citeSource);
    const authorShort = esc(copy.overlay.citationAuthorShort);
    const authorFull = esc(copy.overlay.citationAuthorFull);
    const authorBib = esc(copy.overlay.citationAuthorBib);
    const key = esc(copy.overlay.citationKey);
    switch (style) {
      case "APA":
        return `${authorShort} (${year}). <em>${title}</em>. <em>${source}</em>.`;
      case "MLA":
        return `${authorFull}. "${title}." <em>${source}</em>, ${date}.`;
      case "Chicago":
        return `${authorFull}. "${title}." <em>${source}</em>. ${date}.`;
      case "Harvard":
        return `${authorShort} (${year}) '${title}', <em>${source}</em>.`;
      case "BibTeX":
        return `@article{${key}${year},\n  author={${authorBib}},\n  title={${title}},\n  year={${year}},\n  journal={${source}}\n}`;
      default:
        return "";
    }
  }

  function setCit(paperId, style) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper) return;
    document.getElementById("cit-out").innerHTML = cite(paper, style);
    document.querySelectorAll(".cs-btn").forEach((button) => button.classList.toggle("active", button.dataset.s === style));
  }

  function openPaper(id) {
    const paper = state.papers.find((item) => item.id === id);
    if (!paper) return;
    const dateLabel = paper.date || String(paper.year);
    const timeLabel = paper.time ? `${paper.time}${copy.overlay.timeSuffix}` : "";
    const kwLabel = paper.kw.length ? paper.kw.join(copy.overlay.kwSeparator) : copy.overlay.keywordsEmpty;
    const bodyParagraphs = String(paper.bodyText || "").split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
    document.getElementById("ov-label").textContent = `${dateLabel} - ${timeLabel}`;
    const abstractParagraphs = [
      esc(paper.summary),
      bodyParagraphs[0] ? esc(bodyParagraphs[0]) : esc(copy.overlay.placeholder.abstractParagraphs[0]),
      bodyParagraphs[1] ? esc(bodyParagraphs[1]) : esc(copy.overlay.placeholder.abstractParagraphs[1]),
    ].filter(Boolean);
    const bodyMarkup = bodyParagraphs.length
      ? bodyParagraphs.slice(2, 7).map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")
      : `
        <span class="sec-mark">${esc(copy.overlay.placeholder.sectionMarks[0])}</span>
        <p>${esc(copy.overlay.placeholder.bodyParagraphs[0])}</p>
        <h2>${esc(copy.overlay.placeholder.headings[0])}</h2>
        <p>${esc(copy.overlay.placeholder.bodyParagraphs[1])}</p>
        <blockquote>${esc(copy.overlay.placeholder.blockquote)}</blockquote>
        <p>${esc(copy.overlay.placeholder.bodyParagraphs[2])}</p>
        <h2>${esc(copy.overlay.placeholder.headings[1])}</h2>
        <span class="sec-mark">${esc(copy.overlay.placeholder.sectionMarks[1])}</span>
        <p>${esc(copy.overlay.placeholder.bodyParagraphs[3])}</p>
        <p>${esc(copy.overlay.placeholder.bodyParagraphs[4])}</p>`;
    const downloadMarkup = [
      paper.documentUrl
        ? `<a class="btn-dl dl-pdf" href="${esc(paper.documentUrl)}" target="_blank" rel="noreferrer">${esc(paper.documentName || copy.overlay.downloadButtons[0])}</a>`
        : `<button class="btn-dl dl-pdf" disabled>${esc(copy.overlay.downloadButtons[0])}</button>`,
      paper.publicationLink
        ? `<a class="btn-dl dl-txt" href="${esc(paper.publicationLink)}" target="_blank" rel="noreferrer">${esc(paper.publicationName || copy.overlay.downloadButtons[1])}</a>`
        : `<button class="btn-dl dl-txt" disabled>${esc(copy.overlay.downloadButtons[1])}</button>`,
      `<button class="btn-dl dl-cit" disabled>${esc(copy.overlay.downloadButtons[2])}</button>`,
    ].join("");

    document.getElementById("ov-body").innerHTML = `
      <div class="ov-kicker">${esc(paper.cat)}</div>
      <h1 class="ov-title">${esc(paper.title)}</h1>
      ${paper.subtitle ? `<p class="ov-subtitle">${esc(paper.subtitle)}</p>` : ""}
      <div class="ov-meta">
        <div class="ov-mc"><div class="ov-ml">${esc(copy.overlay.metaLabels.author)}</div><div class="ov-mv">${esc(copy.hero.byName)}</div></div>
        <div class="ov-mc"><div class="ov-ml">${esc(copy.overlay.metaLabels.date)}</div><div class="ov-mv">${esc(dateLabel)}</div></div>
        <div class="ov-mc"><div class="ov-ml">${esc(copy.overlay.metaLabels.readingTime)}</div><div class="ov-mv">${esc(paper.time)}</div></div>
        <div class="ov-mc"><div class="ov-ml">${esc(copy.overlay.metaLabels.keywords)}</div><div class="ov-mv">${esc(kwLabel)}</div></div>
      </div>
      <div class="ov-cite">
        <div class="ov-cite-body">
          <div class="ov-cite-lbl">${esc(copy.overlay.citeLabel)}</div>
          <div class="ov-cite-txt" id="cit-out">${cite(paper, "APA")}</div>
        </div>
        <div class="ov-cite-styles">
          ${citStyles.map((style) => `<button class="cs-btn${style === "APA" ? " active" : ""}" data-s="${esc(style)}" data-pid="${encodeURIComponent(String(paper.id))}">${esc(style)}</button>`).join("")}
        </div>
      </div>
      <div class="ov-abstract">
        <div class="ov-abs-lbl">${esc(copy.overlay.abstractLabel)}</div>
        ${abstractParagraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}
      </div>
      <div class="ov-text">${bodyMarkup}</div>
      <div class="ov-dls">${downloadMarkup}</div>`;

    document.querySelectorAll(".cs-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const style = button.getAttribute("data-s") || "APA";
        const paperId = decodeURIComponent(button.getAttribute("data-pid") || "");
        setCit(paperId, style);
      });
    });
    const overlay = document.getElementById("overlay");
    overlay.classList.add("open");
    overlay.scrollTop = 0;
    document.body.style.overflow = "hidden";
  }

  function closeOverlay() {
    document.getElementById("overlay").classList.remove("open");
    document.body.style.overflow = "";
  }

  window.closeOverlay = closeOverlay;
  window.openPaper = openPaper;
  window.doFilter = doFilter;
  window.moveFeat = moveFeat;
  window.goFeat = goFeat;

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeOverlay();
    if (document.getElementById("overlay").classList.contains("open")) return;
    if (event.key === "ArrowRight") moveFeat(1);
    if (event.key === "ArrowLeft") moveFeat(-1);
  });

  document.getElementById("s-in")?.addEventListener("input", doFilter);
  document.getElementById("f-cat")?.addEventListener("change", doFilter);
  document.getElementById("f-yr")?.addEventListener("change", doFilter);
  document.getElementById("f-tp")?.addEventListener("change", doFilter);

  initTypewriter(copy);

  Promise.all([loadSectionMediaConfig(), loadPapers(copy)]).then(([sectionMedia, papers]) => {
    applySectionMedia(sectionMedia);
    state.papers = papers;
    state.featured = papers.filter((paper) => paper.featured).sort((a, b) => a.featuredRank - b.featuredRank || String(a.title).localeCompare(String(b.title)));
    if (!state.featured.length && papers.length) {
      state.featured = papers.slice(0, 3);
    }
    populateFilters(state.papers);
    buildFeatDots();
    updateFeat(0);
    resetAutoTimer();
    buildList(state.papers);
  });
}

initSelectedPapersPage();
