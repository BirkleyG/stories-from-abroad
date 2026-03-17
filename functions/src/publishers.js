import admin from "firebase-admin";

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

function getFieldValue() {
  return admin.firestore.FieldValue;
}

export const ADMIN_COLLECTIONS = {
  faces: "admin_faces",
  papers: "admin_papers",
  travel: "admin_dispatches",
  photography: "admin_shoots",
};

export const PUBLIC_COLLECTIONS = {
  faces: "faces",
  papers: "papers",
  travel: "scrap_sheet_posts",
  travelQuotes: "scrap_sheet_quotes",
  photography: "photo_shoots",
};

function cleanString(value) {
  return String(value || "").trim();
}

function slugify(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function ensureIsoDate(value) {
  const raw = cleanString(value);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function ensureIsoDateTime(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = cleanString(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeMedia(media = {}) {
  return {
    assetId: cleanString(media.assetId),
    url: cleanString(media.url),
    alt: cleanString(media.alt),
    title: cleanString(media.title),
    caption: cleanString(media.caption),
    locationLabel: cleanString(media.locationLabel),
    storagePath: cleanString(media.storagePath),
    contentType: cleanString(media.contentType),
    fileName: cleanString(media.fileName),
    focusX: Number.isFinite(Number(media.focusX)) ? Number(media.focusX) : 50,
    focusY: Number.isFinite(Number(media.focusY)) ? Number(media.focusY) : 50,
    width: Number.isFinite(Number(media.width)) ? Number(media.width) : null,
    height: Number.isFinite(Number(media.height)) ? Number(media.height) : null,
    cameraModel: cleanString(media.cameraModel),
    exifDate: cleanString(media.exifDate),
  };
}

function normalizeReadTime(value, fallbackText) {
  const raw = cleanString(value);
  if (!raw) {
    const words = cleanString(fallbackText).split(/\s+/).filter(Boolean).length;
    return `${Math.max(1, Math.ceil(words / 220))} min`;
  }
  if (/\bmin\b/i.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `${raw} min`;
  return raw;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isValidLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function isValidLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function normalizeCoordinates(longitudeValue, latitudeValue) {
  const longitude = toNumber(longitudeValue);
  const latitude = toNumber(latitudeValue);
  if (isValidLongitude(longitude) && isValidLatitude(latitude)) {
    return { longitude, latitude, swapped: false };
  }
  if (isValidLongitude(latitude) && isValidLatitude(longitude) && isValidLatitude(longitude)) {
    return { longitude: latitude, latitude: longitude, swapped: true };
  }
  return null;
}

async function resolveUniqueSlug(collectionName, desiredSlug, docId) {
  const db = getDb();
  const base = slugify(desiredSlug) || `item-${docId}`;
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const snapshot = await db.collection(collectionName).where("slug", "==", candidate).limit(1).get();
    if (snapshot.empty || snapshot.docs[0].id === docId) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function normalizeFaceBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      if (!block || typeof block !== "object") return null;
      if (block.type === "qa") {
        const q = cleanString(block.question || block.q);
        const a = cleanString(block.answer || block.a);
        return q && a ? { type: "qa", q, a } : null;
      }
      if (block.type === "quote" || block.type === "pull") {
        const text = cleanString(block.text);
        return text ? { type: "pull", text } : null;
      }
      if (block.type === "photo") {
        const media = normalizeMedia(block);
        if (!media.url) return null;
        return {
          type: "photo",
          id: cleanString(block.id) || `p${index + 1}`,
          media,
        };
      }
      const text = cleanString(block.text);
      return text ? { type: "para", text } : null;
    })
    .filter(Boolean);
}

function buildFacePublic(draft, slug) {
  const articlePhotos = {};
  const article = normalizeFaceBlocks(draft.bodyBlocks).map((block) => {
    if (block.type !== "photo") return block;
    articlePhotos[block.id] = block.media;
    return { type: "photo", id: block.id };
  });
  const excerpt = firstNonEmpty(
    draft.excerpt,
    Array.isArray(draft.quotes) ? draft.quotes[0]?.text : "",
    Array.isArray(draft.bodyBlocks) ? draft.bodyBlocks.find((block) => block?.type === "paragraph")?.text : "",
    draft.subtitle
  );
  const coords = normalizeCoordinates(draft.longitude, draft.latitude);
  if (!coords) {
    throw new Error("Faces drafts require valid longitude and latitude before publishing.");
  }
  return {
    slug,
    storyTitle: firstNonEmpty(draft.title, draft.profileName),
    subtitle: cleanString(draft.subtitle),
    name: firstNonEmpty(draft.profileName, draft.title, "Untitled Portrait"),
    age: cleanString(draft.age) ? Number(draft.age) || cleanString(draft.age) : "",
    religion: cleanString(draft.religion),
    occupation: cleanString(draft.occupation),
    city: cleanString(draft.locationName),
    country: cleanString(draft.countryRegion),
    date: ensureIsoDate(draft.publishDate),
    lngLat: [coords.longitude, coords.latitude],
    pic: cleanString(draft.portrait?.url) || cleanString(draft.hero?.url) || slug,
    portraitUrl: cleanString(draft.portrait?.url),
    portraitAlt: cleanString(draft.portrait?.alt) || cleanString(draft.profileName),
    heroUrl: cleanString(draft.hero?.url) || cleanString(draft.portrait?.url),
    heroAlt: cleanString(draft.hero?.alt) || cleanString(draft.title) || cleanString(draft.profileName),
    descriptor: firstNonEmpty(draft.descriptor, draft.subtitle),
    excerpt,
    article: article.length ? article : [{ type: "para", text: excerpt || "A portrait from the road." }],
    articlePhotos,
    gallery: (Array.isArray(draft.gallery) ? draft.gallery : []).map(normalizeMedia).filter((item) => item.url),
    quotes: (Array.isArray(draft.quotes) ? draft.quotes : []).map((quote) => ({
      id: cleanString(quote.id),
      text: cleanString(quote.text),
      style: cleanString(quote.style) || "pull",
    })).filter((quote) => quote.text),
    facts: (Array.isArray(draft.facts) ? draft.facts : []).map(cleanString).filter(Boolean),
  };
}

function buildPaperPublic(draft, slug) {
  const publishDate = firstNonEmpty(draft.customDisplayDate, draft.publishDate, new Date().toISOString().slice(0, 10));
  const year = Number(String(publishDate).slice(0, 4)) || new Date().getFullYear();
  return {
    slug,
    title: cleanString(draft.title),
    subtitle: cleanString(draft.subtitle),
    category: firstNonEmpty(draft.badgeStyle, draft.type),
    year,
    date: publishDate,
    keywords: (Array.isArray(draft.keywords) ? draft.keywords : []).map(cleanString).filter(Boolean),
    readTime: normalizeReadTime(draft.readTime, draft.bodyText || draft.summary),
    type: cleanString(draft.type) || "paper",
    featured: Boolean(draft.featured),
    featuredRank: cleanString(draft.featuredRank) ? Number(draft.featuredRank) || null : null,
    summary: cleanString(draft.summary),
    bodyText: cleanString(draft.bodyText),
    publicationName: cleanString(draft.publicationName),
    publicationLink: cleanString(draft.publicationLink),
    badgeStyle: cleanString(draft.badgeStyle) || "Published",
    documentUrl: cleanString(draft.document?.url),
    documentName: firstNonEmpty(draft.document?.fileName, draft.document?.title, draft.document?.caption),
    externalPublication: Boolean(draft.externalPublication),
  };
}

function buildTravelPublic(draft, slug) {
  const coords = normalizeCoordinates(draft.longitude, draft.latitude);
  if (!coords) {
    throw new Error("Travel drafts require valid longitude and latitude before publishing.");
  }
  return {
    slug,
    category: cleanString(draft.dispatchType) || "travel",
    audienceLevel: cleanString(draft.audienceLevel) || "standard",
    location: cleanString(draft.locationName),
    date: ensureIsoDate(draft.publishDate),
    time: cleanString(draft.timeLabel),
    title: cleanString(draft.title),
    preview: firstNonEmpty(draft.excerpt, cleanString(draft.bodyText).split(/\n+/)[0]),
    full: cleanString(draft.bodyText),
    photos: (Array.isArray(draft.photos) ? draft.photos : []).map(normalizeMedia).filter((item) => item.url).map((item) => ({
      url: item.url,
      caption: item.caption,
      title: item.title,
      locationLabel: item.locationLabel,
    })),
    pinned: Boolean(draft.pinned),
    lngLat: [coords.longitude, coords.latitude],
  };
}

function cleanPhotographyBlocks(blocks = []) {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => {
      if (!block || typeof block !== "object") return null;
      if (block.type === "text-note") {
        const noteLabel = cleanString(block.noteLabel) || "Field Note";
        const title = cleanString(block.title);
        const text = cleanString(block.text);
        if (!title && !text) return null;
        return { id: cleanString(block.id) || `pb${index + 1}`, type: "text-note", noteLabel, title, text };
      }
      if (block.type === "section-title") {
        const tag = cleanString(block.tag);
        const title = cleanString(block.title);
        const rightNote = cleanString(block.rightNote);
        if (!tag && !title && !rightNote) return null;
        return { id: cleanString(block.id) || `pb${index + 1}`, type: "section-title", tag, title, rightNote };
      }
      if (block.type === "hero-photo") {
        const photo = normalizeMedia(block.photo || block);
        if (!photo.url) return null;
        return { id: cleanString(block.id) || `pb${index + 1}`, type: "hero-photo", eyebrow: cleanString(block.eyebrow), photo };
      }
      if (block.type === "full-photo") {
        const photo = normalizeMedia(block.photo || block);
        if (!photo.url) return null;
        return { id: cleanString(block.id) || `pb${index + 1}`, type: "full-photo", height: Number(block.height) || 860, photo };
      }
      if (block.type === "ghost-text-row") {
        const photos = (Array.isArray(block.photos) ? block.photos : []).map(normalizeMedia).filter((item) => item.url);
        if (!photos.length) return null;
        return {
          id: cleanString(block.id) || `pb${index + 1}`,
          type: "ghost-text-row",
          ghostText: cleanString(block.ghostText),
          ghostPosition: cleanString(block.ghostPosition) || "center",
          height: Number(block.height) || 540,
          photos,
        };
      }
      const photos = (Array.isArray(block.photos) ? block.photos : []).map(normalizeMedia).filter((item) => item.url);
      if (!photos.length) return null;
      return {
        id: cleanString(block.id) || `pb${index + 1}`,
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
          ghostText: block.type === "ghost-text-row" ? cleanString(block.ghostText) : "",
          ...photo,
        });
      });
    }
  });
  return all;
}

function derivePhotographyCamera(blocks = [], explicit = "") {
  const override = cleanString(explicit);
  if (override) return override;
  for (const block of blocks || []) {
    if (block?.photo?.cameraModel) return cleanString(block.photo.cameraModel);
    const media = (block?.photos || []).find((photo) => cleanString(photo?.cameraModel));
    if (media) return cleanString(media.cameraModel);
  }
  return "";
}

function countPhotographyFrames(blocks = []) {
  return (blocks || []).reduce((total, block) => {
    if (block?.type === "hero-photo" || block?.type === "full-photo") return total + (block.photo?.url ? 1 : 0);
    if (block?.type === "photo-row" || block?.type === "ghost-text-row") return total + ((block.photos || []).filter((photo) => photo?.url).length);
    return total;
  }, 0);
}

function buildPhotographyPublic(draft, slug) {
  const blocks = cleanPhotographyBlocks(draft.blocks);
  const allPhotos = flattenPhotographyPhotos(blocks);
  if (!allPhotos.length) {
    throw new Error("Photography shoots require at least one attached image before publishing.");
  }
  const heroBlock = blocks.find((block) => block.type === "hero-photo");
  const coverPhoto = heroBlock?.photo?.url ? heroBlock.photo : allPhotos[0];
  return {
    slug,
    title: cleanString(draft.title),
    subtitle: cleanString(draft.subtitle),
    shootDate: ensureIsoDate(draft.shootDate),
    locationLabel: firstNonEmpty(draft.locationLabel, [cleanString(draft.city), cleanString(draft.country)].filter(Boolean).join(", ")),
    city: cleanString(draft.city),
    country: cleanString(draft.country),
    descriptor: cleanString(draft.descriptor),
    accentColor: cleanString(draft.accentColor) || "#c96b28",
    template: cleanString(draft.template) || "desert-bloom",
    cameraModel: derivePhotographyCamera(blocks, draft.cameraModel),
    frameCount: countPhotographyFrames(blocks),
    notes: cleanString(draft.notes),
    coverPhoto,
    allPhotos,
    blocks,
  };
}

async function writeVersion(adminRef, reason, actor, snapshot) {
  const FieldValue = getFieldValue();
  await adminRef.collection("versions").add({
    reason,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: actor,
    snapshot,
  });
}

export async function publishDraft(kind, id, actor = "system") {
  const db = getDb();
  const FieldValue = getFieldValue();
  const adminRef = db.collection(ADMIN_COLLECTIONS[kind]).doc(id);
  const adminSnap = await adminRef.get();
  if (!adminSnap.exists) {
    throw new Error("Draft not found.");
  }
  const draft = adminSnap.data() || {};
  const slug = await resolveUniqueSlug(PUBLIC_COLLECTIONS[kind], draft.slug || draft.title || draft.profileName || draft.locationName || id, id);
  const batch = db.batch();
  let publicData = null;

  if (kind === "faces") {
    publicData = buildFacePublic(draft, slug);
    batch.set(db.collection(PUBLIC_COLLECTIONS.faces).doc(id), publicData);
  } else if (kind === "papers") {
    publicData = buildPaperPublic(draft, slug);
    batch.set(db.collection(PUBLIC_COLLECTIONS.papers).doc(id), publicData);
  } else if (kind === "travel") {
    publicData = buildTravelPublic(draft, slug);
    const quotesSnap = await db.collection(PUBLIC_COLLECTIONS.travelQuotes).where("postId", "==", id).get();
    quotesSnap.forEach((doc) => batch.delete(doc.ref));
    batch.set(db.collection(PUBLIC_COLLECTIONS.travel).doc(id), publicData);
    (Array.isArray(draft.quotes) ? draft.quotes : []).map((quote) => cleanString(quote.text)).filter(Boolean).forEach((text, index) => {
      batch.set(db.collection(PUBLIC_COLLECTIONS.travelQuotes).doc(`${id}-quote-${index + 1}`), {
        text,
        postId: id,
      });
    });
  } else if (kind === "photography") {
    publicData = buildPhotographyPublic(draft, slug);
    batch.set(db.collection(PUBLIC_COLLECTIONS.photography).doc(id), publicData);
  } else {
    throw new Error(`Unsupported content kind: ${kind}`);
  }

  const publishedRecord = {
    collection: PUBLIC_COLLECTIONS[kind],
    docId: id,
    slug,
    publishedAt: new Date().toISOString(),
    ...(kind === "photography" ? {
      blocks: publicData.blocks,
      coverPhoto: publicData.coverPhoto,
      frameCount: publicData.frameCount,
      cameraModel: publicData.cameraModel,
      accentColor: publicData.accentColor,
    } : {}),
  };

  batch.set(adminRef, {
    slug,
    status: "published",
    publishedAt: FieldValue.serverTimestamp(),
    publishedRecord,
    scheduledPublishAt: "",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  }, { merge: true });

  await batch.commit();
  await writeVersion(adminRef, "publish", actor, draft);
  return { slug, publicData };
}

export async function unpublishDraft(kind, id, actor = "system") {
  const db = getDb();
  const FieldValue = getFieldValue();
  const adminRef = db.collection(ADMIN_COLLECTIONS[kind]).doc(id);
  const batch = db.batch();
  if (kind === "travel") {
    const quotesSnap = await db.collection(PUBLIC_COLLECTIONS.travelQuotes).where("postId", "==", id).get();
    quotesSnap.forEach((doc) => batch.delete(doc.ref));
  }
  batch.delete(db.collection(PUBLIC_COLLECTIONS[kind]).doc(id));
  batch.set(adminRef, {
    status: "archived",
    publishedRecord: FieldValue.delete(),
    scheduledPublishAt: "",
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
    unpublishedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return { id };
}

export async function scheduleDraft(kind, id, scheduledPublishAt, actor = "system") {
  const db = getDb();
  const FieldValue = getFieldValue();
  const iso = ensureIsoDateTime(scheduledPublishAt);
  if (!iso) {
    throw new Error("A valid publish time is required.");
  }
  if (new Date(iso).getTime() <= Date.now()) {
    throw new Error("Scheduled publish time must be in the future.");
  }
  await db.collection(ADMIN_COLLECTIONS[kind]).doc(id).set({
    status: "scheduled",
    scheduledPublishAt: iso,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  }, { merge: true });
  return { scheduledPublishAt: iso };
}

export async function processScheduledKind(kind, nowIso) {
  const db = getDb();
  const snapshot = await db.collection(ADMIN_COLLECTIONS[kind]).where("scheduledPublishAt", "<=", nowIso).limit(20).get();
  let processed = 0;
  for (const doc of snapshot.docs) {
    const draft = doc.data() || {};
    if (draft.status !== "scheduled") continue;
    await publishDraft(kind, doc.id, "scheduler");
    processed += 1;
  }
  return processed;
}

async function repairCollectionCoordinates(adminCollection, publicCollection) {
  const db = getDb();
  let repaired = 0;
  const snapshot = await db.collection(adminCollection).get();
  for (const item of snapshot.docs) {
    const data = item.data() || {};
    const coords = normalizeCoordinates(data.longitude, data.latitude);
    if (!coords) continue;
    if (String(data.longitude) === String(coords.longitude) && String(data.latitude) === String(coords.latitude)) continue;
    await item.ref.set({
      longitude: String(coords.longitude),
      latitude: String(coords.latitude),
      updatedAt: getFieldValue().serverTimestamp(),
      updatedBy: "coordinate-repair",
    }, { merge: true });
    const publicRef = db.collection(publicCollection).doc(item.id);
    const publicSnap = await publicRef.get();
    if (publicSnap.exists) {
      await publicRef.set({ lngLat: [coords.longitude, coords.latitude] }, { merge: true });
    }
    repaired += 1;
  }
  return repaired;
}

export async function repairCoordinateData() {
  const faces = await repairCollectionCoordinates(ADMIN_COLLECTIONS.faces, PUBLIC_COLLECTIONS.faces);
  const travel = await repairCollectionCoordinates(ADMIN_COLLECTIONS.travel, PUBLIC_COLLECTIONS.travel);
  return { faces, travel, total: faces + travel };
}
