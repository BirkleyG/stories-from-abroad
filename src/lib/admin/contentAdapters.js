import { hydrateDraft } from "./schemas";
import { validateCoordinates } from "./coordinates";

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function ensureIsoDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export function ensureIsoDateTime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

export function estimateReadTime(text) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function normalizeReadTime(value, fallbackSource) {
  const raw = String(value || "").trim();
  if (!raw) return `${estimateReadTime(fallbackSource)} min`;
  if (/\d/.test(raw) && /\bmin\b/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${raw} min`;
  return raw;
}

export function collectSearchText(kind, draftInput) {
  const draft = hydrateDraft(kind, draftInput);
  if (kind === "faces") {
    return [
      draft.title,
      draft.subtitle,
      draft.profileName,
      draft.descriptor,
      draft.locationName,
      draft.countryRegion,
      draft.religion,
      draft.occupation,
      draft.excerpt,
      ...(draft.facts || []),
      ...(draft.quotes || []).map((quote) => quote.text),
      ...(draft.bodyBlocks || []).map((block) => block.text || block.question || block.answer || block.caption || block.title || ""),
    ].join(" ").toLowerCase();
  }
  if (kind === "papers") {
    return [
      draft.title,
      draft.subtitle,
      draft.type,
      draft.publicationName,
      draft.summary,
      draft.bodyText,
      ...(draft.keywords || []),
    ].join(" ").toLowerCase();
  }
  return [
    draft.title,
    draft.dispatchType,
    draft.locationName,
    draft.excerpt,
    draft.bodyText,
    ...(draft.quotes || []).map((quote) => quote.text),
  ].join(" ").toLowerCase();
}

function cleanMedia(media = {}) {
  return {
    assetId: String(media.assetId || ""),
    url: String(media.url || "").trim(),
    alt: String(media.alt || "").trim(),
    title: String(media.title || "").trim(),
    caption: String(media.caption || "").trim(),
    storagePath: String(media.storagePath || "").trim(),
    contentType: String(media.contentType || "").trim(),
    fileName: String(media.fileName || "").trim(),
  };
}

function firstNonEmpty(items) {
  for (const item of items) {
    const normalized = String(item ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function cleanFaceBlocks(blocks = []) {
  return blocks
    .map((block, index) => {
      if (!block || typeof block !== "object") return null;
      if (block.type === "qa") {
        const question = String(block.question || block.q || "").trim();
        const answer = String(block.answer || block.a || "").trim();
        if (!question && !answer) return null;
        return { id: block.id || `p${index + 1}`, type: "qa", question, answer };
      }
      if (block.type === "quote") {
        const text = String(block.text || "").trim();
        return text ? { id: block.id || `p${index + 1}`, type: "quote", text } : null;
      }
      if (block.type === "photo") {
        const media = cleanMedia(block);
        return media.url ? { id: block.id || `p${index + 1}`, type: "photo", ...media } : null;
      }
      const text = String(block.text || "").trim();
      return text ? { id: block.id || `p${index + 1}`, type: "paragraph", text } : null;
    })
    .filter(Boolean);
}

export function prepareDraftForSave(kind, draftInput) {
  const draft = hydrateDraft(kind, draftInput);
  const common = {
    status: draft.status,
    slug: slugify(draft.slug || draft.title || draft.profileName || draft.locationName),
    scheduledPublishAt: ensureIsoDateTime(draft.scheduledPublishAt) || "",
    publishDate: ensureIsoDate(draft.publishDate) || "",
    searchText: collectSearchText(kind, draft),
  };

  if (kind === "faces") {
    return {
      ...draft,
      ...common,
      title: String(draft.title || "").trim(),
      subtitle: String(draft.subtitle || "").trim(),
      profileName: String(draft.profileName || "").trim(),
      descriptor: String(draft.descriptor || "").trim(),
      locationName: String(draft.locationName || "").trim(),
      countryRegion: String(draft.countryRegion || "").trim(),
      longitude: String(draft.longitude || "").trim(),
      latitude: String(draft.latitude || "").trim(),
      age: String(draft.age || "").trim(),
      religion: String(draft.religion || "").trim(),
      occupation: String(draft.occupation || "").trim(),
      excerpt: String(draft.excerpt || "").trim(),
      portrait: cleanMedia(draft.portrait),
      hero: cleanMedia(draft.hero),
      gallery: (draft.gallery || []).map(cleanMedia).filter((item) => item.url || item.caption || item.title),
      facts: (draft.facts || []).map((fact) => String(fact || "").trim()).filter(Boolean),
      quotes: (draft.quotes || []).map((quote) => ({
        id: quote.id,
        text: String(quote.text || "").trim(),
        style: String(quote.style || "pull").trim() || "pull",
      })).filter((quote) => quote.text),
      bodyBlocks: cleanFaceBlocks(draft.bodyBlocks),
    };
  }

  if (kind === "papers") {
    return {
      ...draft,
      ...common,
      title: String(draft.title || "").trim(),
      subtitle: String(draft.subtitle || "").trim(),
      type: String(draft.type || "paper").trim() || "paper",
      publicationName: String(draft.publicationName || "").trim(),
      publicationLink: String(draft.publicationLink || "").trim(),
      badgeStyle: String(draft.badgeStyle || "Published").trim() || "Published",
      customDisplayDate: String(draft.customDisplayDate || "").trim(),
      summary: String(draft.summary || "").trim(),
      bodyText: String(draft.bodyText || "").trim(),
      keywords: (draft.keywords || []).map((keyword) => String(keyword || "").trim()).filter(Boolean),
      readTime: normalizeReadTime(draft.readTime, draft.bodyText || draft.summary),
      featuredRank: draft.featuredRank === "" ? "" : Number(draft.featuredRank) || "",
      document: cleanMedia(draft.document),
      externalPublication: Boolean(draft.externalPublication),
      featured: Boolean(draft.featured),
    };
  }

  return {
    ...draft,
    ...common,
    title: String(draft.title || "").trim(),
    dispatchType: String(draft.dispatchType || "travel").trim() || "travel",
    audienceLevel: String(draft.audienceLevel || "standard").trim() || "standard",
    locationName: String(draft.locationName || "").trim(),
    longitude: String(draft.longitude || "").trim(),
    latitude: String(draft.latitude || "").trim(),
    excerpt: String(draft.excerpt || "").trim(),
    bodyText: String(draft.bodyText || "").trim(),
    timeLabel: String(draft.timeLabel || "").trim(),
    pinned: Boolean(draft.pinned),
    photos: (draft.photos || []).map(cleanMedia).filter((item) => item.url),
    quotes: (draft.quotes || []).map((quote) => ({
      id: quote.id,
      text: String(quote.text || "").trim(),
    })).filter((quote) => quote.text),
  };
}

export function buildVersionSnapshot(kind, draftInput) {
  const prepared = prepareDraftForSave(kind, draftInput);
  const snapshot = JSON.parse(JSON.stringify(prepared));
  delete snapshot.createdAt;
  delete snapshot.updatedAt;
  delete snapshot.publishedAt;
  delete snapshot.lastVersionAt;
  return snapshot;
}

export function faceDraftToPublic(draftInput, slugOverride = "") {
  const draft = prepareDraftForSave("faces", draftInput);
  const storySlug = slugOverride || draft.slug || slugify(draft.profileName || draft.title || draft.locationName);
  const coords = validateCoordinates(draft.longitude, draft.latitude);
  const articlePhotos = {};
  const article = draft.bodyBlocks.map((block, index) => {
    if (block.type === "qa") {
      return { type: "qa", q: block.question, a: block.answer };
    }
    if (block.type === "quote") {
      return { type: "pull", text: block.text };
    }
    if (block.type === "photo") {
      const photoId = block.id || `p${index + 1}`;
      articlePhotos[photoId] = {
        url: block.url,
        alt: block.alt,
        caption: block.caption,
        title: block.title,
      };
      return { type: "photo", id: photoId };
    }
    return { type: "para", text: block.text };
  });

  const excerpt = firstNonEmpty([
    draft.excerpt,
    draft.quotes[0]?.text,
    draft.bodyBlocks.find((block) => block.type === "paragraph")?.text,
    draft.subtitle,
  ]);

  return {
    slug: storySlug,
    storyTitle: firstNonEmpty([draft.title, draft.profileName]),
    subtitle: draft.subtitle,
    name: firstNonEmpty([draft.profileName, draft.title, "Untitled Portrait"]),
    age: draft.age ? Number(draft.age) || draft.age : "",
    religion: draft.religion,
    occupation: draft.occupation,
    city: draft.locationName,
    country: draft.countryRegion,
    date: draft.publishDate || ensureIsoDate(new Date().toISOString()),
    lngLat: coords.isValid ? [coords.longitude, coords.latitude] : null,
    pic: draft.portrait.url || draft.hero.url || storySlug,
    portraitUrl: draft.portrait.url || "",
    portraitAlt: draft.portrait.alt || draft.profileName,
    heroUrl: draft.hero.url || draft.portrait.url || "",
    heroAlt: draft.hero.alt || draft.title || draft.profileName,
    descriptor: firstNonEmpty([draft.descriptor, draft.subtitle]),
    excerpt,
    article,
    articlePhotos,
    gallery: draft.gallery,
    quotes: draft.quotes,
    facts: draft.facts,
  };
}

export function paperDraftToPublic(draftInput) {
  const draft = prepareDraftForSave("papers", draftInput);
  const publishDate = draft.customDisplayDate || draft.publishDate || ensureIsoDate(new Date().toISOString());
  const year = Number((publishDate || "").slice(0, 4)) || new Date().getFullYear();
  return {
    slug: draft.slug || slugify(draft.title),
    title: draft.title,
    subtitle: draft.subtitle,
    category: draft.badgeStyle || draft.type,
    year,
    date: publishDate,
    keywords: draft.keywords,
    readTime: draft.readTime || `${estimateReadTime(draft.bodyText || draft.summary)} min`,
    type: draft.type,
    featured: draft.featured,
    featuredRank: draft.featuredRank === "" ? null : Number(draft.featuredRank) || null,
    summary: draft.summary,
    bodyText: draft.bodyText,
    publicationName: draft.publicationName,
    publicationLink: draft.publicationLink,
    badgeStyle: draft.badgeStyle,
    documentUrl: draft.document.url,
    documentName: draft.document.fileName || draft.document.title || draft.document.caption || "",
    externalPublication: draft.externalPublication,
  };
}

export function dispatchDraftToPublic(draftInput, slugOverride = "") {
  const draft = prepareDraftForSave("travel", draftInput);
  const publishDate = draft.publishDate || ensureIsoDate(new Date().toISOString());
  const coords = validateCoordinates(draft.longitude, draft.latitude);
  return {
    post: {
      slug: slugOverride || draft.slug || slugify(`${draft.title}-${draft.locationName}`),
      category: draft.dispatchType,
      audienceLevel: draft.audienceLevel,
      location: draft.locationName,
      date: publishDate,
      time: draft.timeLabel,
      title: draft.title,
      preview: firstNonEmpty([draft.excerpt, draft.bodyText.split(/\n+/)[0]]),
      full: draft.bodyText,
      photos: draft.photos.map((photo) => ({
        url: photo.url,
        caption: photo.caption,
        title: photo.title,
      })),
      pinned: Boolean(draft.pinned),
      lngLat: coords.isValid ? [coords.longitude, coords.latitude] : null,
    },
    quotes: draft.quotes.map((quote) => ({
      text: quote.text,
    })),
  };
}
