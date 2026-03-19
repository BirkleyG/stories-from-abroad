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
  if (kind === "travel") {
    return [
      draft.title,
      draft.dispatchType,
      draft.locationName,
      draft.excerpt,
      draft.bodyText,
      ...(draft.quotes || []).map((quote) => quote.text),
    ].join(" ").toLowerCase();
  }
  return [
    draft.title,
    draft.description,
    draft.locationLabel,
    draft.theme,
    draft.template,
    draft.tagWord1,
    draft.tagWord2,
    draft.tagWord3,
    draft.notes,
    draft.adminNotes,
    ...(draft.photos || []).flatMap((photo) => [photo?.title, photo?.caption, photo?.locationLabel, photo?.shortQuote, photo?.cameraModel]),
    ...(draft.blocks || []).flatMap((block) => {
      if (block.type === "text-note") return [block.noteLabel, block.title, block.text];
      if (block.type === "section-title") return [block.tag, block.title, block.rightNote];
      return [];
    }),
  ].join(" ").toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanMedia(media = {}) {
  return {
    assetId: String(media.assetId || ""),
    url: String(media.url || "").trim(),
    alt: String(media.alt || "").trim(),
    title: String(media.title || "").trim(),
    caption: String(media.caption || "").trim(),
    locationLabel: String(media.locationLabel || "").trim(),
    shutter: String(media.shutter || "").trim(),
    aperture: String(media.aperture || "").trim(),
    iso: String(media.iso || "").trim(),
    lens: String(media.lens || "").trim(),
    metadataEnabled: media.metadataEnabled !== false,
    shortQuote: String(media.shortQuote || "").trim(),
    storagePath: String(media.storagePath || "").trim(),
    contentType: String(media.contentType || "").trim(),
    fileName: String(media.fileName || "").trim(),
    focusX: numberOrNull(media.focusX) ?? 50,
    focusY: numberOrNull(media.focusY) ?? 50,
    width: numberOrNull(media.width),
    height: numberOrNull(media.height),
    cameraModel: String(media.cameraModel || "").trim(),
    exifDate: String(media.exifDate || "").trim(),
  };
}

function firstNonEmpty(items) {
  for (const item of items) {
    const normalized = String(item ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizePhotographyTheme(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "editorial") return "tokyo-fragments";
  if (raw === "documentary") return "desert-fill";
  if (raw === "cinematic") return "desert-bloom";
  if (["desert-bloom", "desert-fill", "kyoto-bold", "tokyo-fragments"].includes(raw)) return raw;
  return "desert-bloom";
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

function cleanPhotoMediaList(photos = []) {
  return (Array.isArray(photos) ? photos : []).map(cleanMedia).filter((item) => item.url);
}

function cleanPhotoBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      if (!block || typeof block !== "object") return null;
      if (block.type === "text-note") {
        const noteLabel = String(block.noteLabel || "Field Note").trim();
        const title = String(block.title || "").trim();
        const text = String(block.text || "").trim();
        if (!title && !text) return null;
        return { id: block.id || `pb${index + 1}`, type: "text-note", noteLabel, title, text };
      }
      if (block.type === "section-title") {
        const tag = String(block.tag || "").trim();
        const title = String(block.title || "").trim();
        const rightNote = String(block.rightNote || "").trim();
        if (!tag && !title && !rightNote) return null;
        return { id: block.id || `pb${index + 1}`, type: "section-title", tag, title, rightNote };
      }
      if (block.type === "ghost-text-row") {
        const photos = cleanPhotoMediaList(block.photos);
        if (!photos.length) return null;
        return {
          id: block.id || `pb${index + 1}`,
          type: "ghost-text-row",
          ghostText: String(block.ghostText || "").trim(),
          ghostPosition: String(block.ghostPosition || "center").trim() || "center",
          height: Number(block.height) || 540,
          photos,
        };
      }
      if (block.type === "hero-photo") {
        const photo = cleanMedia(block.photo || block);
        if (!photo.url) return null;
        return {
          id: block.id || `pb${index + 1}`,
          type: "hero-photo",
          eyebrow: String(block.eyebrow || "").trim(),
          photo,
        };
      }
      if (block.type === "full-photo") {
        const photo = cleanMedia(block.photo || block);
        if (!photo.url) return null;
        return {
          id: block.id || `pb${index + 1}`,
          type: "full-photo",
          height: Number(block.height) || 860,
          photo,
        };
      }
      const photos = cleanPhotoMediaList(block.photos);
      if (!photos.length) return null;
      return {
        id: block.id || `pb${index + 1}`,
        type: "photo-row",
        height: Number(block.height) || 540,
        photos,
      };
    })
    .filter(Boolean);
}

function flattenPhotographyPhotos(blocks = []) {
  const all = [];
  (blocks || []).forEach((block, blockIndex) => {
    if (block?.type === "hero-photo" || block?.type === "full-photo") {
      if (block.photo?.url) {
        all.push({
          id: `${block.id}-0`,
          blockId: block.id,
          blockType: block.type,
          order: all.length,
          blockIndex,
          ...block.photo,
        });
      }
      return;
    }
    if (block?.type === "photo-row" || block?.type === "ghost-text-row") {
      (block.photos || []).forEach((photo, photoIndex) => {
        if (!photo?.url) return;
        all.push({
          id: `${block.id}-${photoIndex}`,
          blockId: block.id,
          blockType: block.type,
          order: all.length,
          blockIndex,
          photoIndex,
          ghostText: block.type === "ghost-text-row" ? block.ghostText || "" : "",
          ...photo,
        });
      });
    }
  });
  return all;
}

function cleanPhotographyPhotos(photos = [], blocks = []) {
  const direct = (Array.isArray(photos) ? photos : [])
    .map((photo) => cleanMedia(photo))
    .filter((photo) => photo.url);
  if (direct.length) {
    return direct.map((photo, index) => ({
      id: String(photo.id || `p${index + 1}`),
      ...photo,
    }));
  }
  return flattenPhotographyPhotos(cleanPhotoBlocks(blocks));
}

function countPhotographyFrames(photos = [], blocks = []) {
  if (Array.isArray(photos) && photos.length) {
    return photos.filter((photo) => photo?.url).length;
  }
  return (blocks || []).reduce((total, block) => {
    if (block?.type === "hero-photo" || block?.type === "full-photo") return total + (block.photo?.url ? 1 : 0);
    if (block?.type === "photo-row" || block?.type === "ghost-text-row") return total + ((block.photos || []).filter((photo) => photo?.url).length);
    return total;
  }, 0);
}

function derivePhotographyCamera(photos = [], blocks = [], explicit = "") {
  const override = String(explicit || "").trim();
  if (override) return override;
  const direct = (Array.isArray(photos) ? photos : []).find((photo) => photo?.cameraModel);
  if (direct?.cameraModel) return direct.cameraModel;
  for (const block of blocks || []) {
    if (block?.photo?.cameraModel) return block.photo.cameraModel;
    const mediaWithCamera = (block?.photos || []).find((photo) => photo?.cameraModel);
    if (mediaWithCamera?.cameraModel) return mediaWithCamera.cameraModel;
  }
  return "";
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

  if (kind === "travel") {
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

  const cleanedBlocks = cleanPhotoBlocks(draft.blocks);
  const cleanedPhotos = cleanPhotographyPhotos(draft.photos, cleanedBlocks);
  const frameCount = countPhotographyFrames(cleanedPhotos, cleanedBlocks);
  const cameraModel = derivePhotographyCamera(cleanedPhotos, cleanedBlocks, draft.cameraModel);
  const theme = normalizePhotographyTheme(draft.theme || draft.template);
  const tags = [
    draft.tagWord1,
    draft.tagWord2,
    draft.tagWord3,
    ...(Array.isArray(draft.tags) ? draft.tags : []),
  ].map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 3);
  return {
    ...draft,
    status: draft.status,
    slug: slugify(draft.slug || draft.title || draft.locationLabel),
    scheduledPublishAt: ensureIsoDateTime(draft.scheduledPublishAt) || "",
    searchText: collectSearchText(kind, draft),
    title: String(draft.title || "").trim(),
    description: String(draft.description || draft.notes || "").trim(),
    shootDate: ensureIsoDate(draft.shootDate) || "",
    locationLabel: String(draft.locationLabel || [draft.city, draft.country].filter(Boolean).join(", ")).trim(),
    city: String(draft.city || "").trim(),
    country: String(draft.country || "").trim(),
    tagWord1: String(draft.tagWord1 || "").trim(),
    tagWord2: String(draft.tagWord2 || "").trim(),
    tagWord3: String(draft.tagWord3 || "").trim(),
    tags,
    theme,
    accentColor: String(draft.accentColor || "#c96b28").trim() || "#c96b28",
    template: theme,
    cameraModel,
    frameCount,
    notes: String(draft.notes || "").trim(),
    adminNotes: String(draft.adminNotes || "").trim(),
    photos: cleanedPhotos,
    allPhotos: cleanedPhotos,
    coverPhoto: cleanedPhotos[0] || null,
    blocks: cleanedBlocks,
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
        locationLabel: block.locationLabel,
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
        locationLabel: photo.locationLabel,
      })),
      pinned: Boolean(draft.pinned),
      lngLat: coords.isValid ? [coords.longitude, coords.latitude] : null,
    },
    quotes: draft.quotes.map((quote) => ({
      text: quote.text,
    })),
  };
}

export function photographyDraftToPublic(draftInput, slugOverride = "") {
  const draft = prepareDraftForSave("photography", draftInput);
  const slug = slugOverride || draft.slug || slugify(`${draft.title}-${draft.locationLabel}`);
  const allPhotos = cleanPhotographyPhotos(draft.photos, draft.blocks);
  const coverPhoto = allPhotos[0] || null;
  const tags = [
    draft.tagWord1,
    draft.tagWord2,
    draft.tagWord3,
    ...(Array.isArray(draft.tags) ? draft.tags : []),
  ].map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 3);
  return {
    slug,
    title: draft.title,
    description: draft.description || draft.notes || "",
    shootDate: draft.shootDate || ensureIsoDate(new Date().toISOString()),
    locationLabel: draft.locationLabel || [draft.city, draft.country].filter(Boolean).join(", "),
    city: draft.city,
    country: draft.country,
    tags,
    theme: normalizePhotographyTheme(draft.theme || draft.template),
    accentColor: draft.accentColor,
    template: normalizePhotographyTheme(draft.theme || draft.template),
    cameraModel: draft.cameraModel || derivePhotographyCamera(allPhotos, draft.blocks),
    frameCount: draft.frameCount || countPhotographyFrames(allPhotos, draft.blocks),
    coverPhoto,
    allPhotos,
    photos: allPhotos,
  };
}
