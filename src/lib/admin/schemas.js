export const CONTENT_KINDS = ["faces", "papers", "travel"];
export const DRAFT_STATUSES = ["draft", "review", "scheduled", "published", "archived"];
export const PAPER_TYPES = ["paper", "op-ed", "essay", "commentary", "report"];
export const DISPATCH_TYPES = [
  { value: "travel", label: "Travel Dispatch" },
  { value: "stories", label: "Short Story" },
  { value: "musings", label: "Musing on the World" },
];
export const AUDIENCE_LEVELS = [
  { value: "standard", label: "Standard Dispatch" },
  { value: "priority", label: "Priority Dispatch" },
  { value: "summary", label: "Summary-Worthy Dispatch" },
];
export const QUOTE_STYLES = ["pull", "inline", "hero"];

export const ADMIN_COLLECTIONS = {
  faces: "admin_faces",
  papers: "admin_papers",
  travel: "admin_dispatches",
  media: "media_assets",
};

export const SITE_CONFIG_COLLECTION = "site_config";
export const SITE_CONFIG_DOCS = {
  sectionMedia: "section_media",
};

export const CONTENT_LABELS = {
  faces: "Faces of the World",
  papers: "Selected Papers",
  travel: "Travel Dispatches",
};

export function createLocalId(prefix = "item") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMediaValue() {
  return {
    assetId: "",
    url: "",
    alt: "",
    title: "",
    caption: "",
    storagePath: "",
    contentType: "",
    fileName: "",
    focusX: 50,
    focusY: 50,
  };
}

export function createFaceBlock(type = "paragraph") {
  const base = { id: createLocalId("face-block"), type };
  if (type === "quote") return { ...base, text: "" };
  if (type === "qa") return { ...base, question: "", answer: "" };
  if (type === "photo") return { ...base, ...createMediaValue() };
  return { ...base, text: "" };
}

export function createEmptyFaceDraft() {
  return {
    kind: "faces",
    status: "draft",
    slug: "",
    title: "",
    subtitle: "",
    profileName: "",
    descriptor: "",
    locationName: "",
    countryRegion: "",
    longitude: "",
    latitude: "",
    publishDate: "",
    scheduledPublishAt: "",
    age: "",
    religion: "",
    occupation: "",
    excerpt: "",
    portrait: createMediaValue(),
    hero: createMediaValue(),
    gallery: [createMediaValue(), createMediaValue()],
    quotes: [{ id: createLocalId("face-quote"), text: "", style: "pull" }],
    facts: [""],
    bodyBlocks: [createFaceBlock("paragraph")],
    publishedRecord: null,
  };
}

export function createEmptyPaperDraft() {
  return {
    kind: "papers",
    status: "draft",
    slug: "",
    title: "",
    subtitle: "",
    type: "paper",
    publishDate: "",
    scheduledPublishAt: "",
    publicationName: "",
    publicationLink: "",
    badgeStyle: "Published",
    externalPublication: false,
    featured: false,
    featuredRank: "",
    customDisplayDate: "",
    summary: "",
    bodyText: "",
    keywords: [""],
    readTime: "",
    document: createMediaValue(),
    publishedRecord: null,
  };
}

export function createEmptyTravelDraft() {
  return {
    kind: "travel",
    status: "draft",
    slug: "",
    title: "",
    dispatchType: "travel",
    audienceLevel: "standard",
    locationName: "",
    longitude: "",
    latitude: "",
    publishDate: "",
    scheduledPublishAt: "",
    excerpt: "",
    bodyText: "",
    timeLabel: "",
    pinned: false,
    photos: [createMediaValue()],
    quotes: [{ id: createLocalId("travel-quote"), text: "" }],
    publishedRecord: null,
  };
}

export function createEmptyDraft(kind) {
  if (kind === "faces") return createEmptyFaceDraft();
  if (kind === "papers") return createEmptyPaperDraft();
  if (kind === "travel") return createEmptyTravelDraft();
  throw new Error(`Unsupported draft kind: ${kind}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMediaValue(value) {
  const base = createMediaValue();
  return { ...base, ...(value || {}) };
}

function normalizeStringList(list, fallbackOne = false) {
  const normalized = Array.isArray(list)
    ? list.map((item) => String(item ?? "")).filter((item, index, arr) => item !== "" || index === arr.length - 1)
    : [];
  if (!normalized.length && fallbackOne) return [""];
  return normalized;
}

function normalizeFaceBlocks(blocks) {
  const source = Array.isArray(blocks) ? blocks : [];
  const normalized = source.map((block) => {
    if (!block || typeof block !== "object") return null;
    if (block.type === "qa") {
      return {
        id: block.id || createLocalId("face-block"),
        type: "qa",
        question: String(block.question ?? block.q ?? ""),
        answer: String(block.answer ?? block.a ?? ""),
      };
    }
    if (block.type === "quote" || block.type === "pull") {
      return {
        id: block.id || createLocalId("face-block"),
        type: "quote",
        text: String(block.text ?? ""),
      };
    }
    if (block.type === "photo") {
      return {
        id: block.id || createLocalId("face-block"),
        type: "photo",
        ...normalizeMediaValue(block),
      };
    }
    return {
      id: block.id || createLocalId("face-block"),
      type: "paragraph",
      text: String(block.text ?? ""),
    };
  }).filter(Boolean);
  return normalized.length ? normalized : [createFaceBlock("paragraph")];
}

export function hydrateDraft(kind, raw = {}) {
  const base = createEmptyDraft(kind);
  const merged = { ...clone(base), ...(raw || {}) };
  if (kind === "faces") {
    const galleryItems = (Array.isArray(merged.gallery) ? merged.gallery : []).map(normalizeMediaValue).slice(0, 8);
    while (galleryItems.length < 2) {
      galleryItems.push(createMediaValue());
    }
    return {
      ...merged,
      portrait: normalizeMediaValue(merged.portrait),
      hero: normalizeMediaValue(merged.hero),
      gallery: galleryItems,
      facts: normalizeStringList(merged.facts, true),
      quotes: (Array.isArray(merged.quotes) ? merged.quotes : []).map((quote) => ({
        id: quote?.id || createLocalId("face-quote"),
        text: String(quote?.text ?? ""),
        style: QUOTE_STYLES.includes(quote?.style) ? quote.style : "pull",
      })),
      bodyBlocks: normalizeFaceBlocks(merged.bodyBlocks),
    };
  }
  if (kind === "papers") {
    return {
      ...merged,
      document: normalizeMediaValue(merged.document),
      keywords: normalizeStringList(merged.keywords, true),
    };
  }
  return {
    ...merged,
    photos: (Array.isArray(merged.photos) ? merged.photos : []).map(normalizeMediaValue).concat([]),
    quotes: (Array.isArray(merged.quotes) ? merged.quotes : []).map((quote) => ({
      id: quote?.id || createLocalId("travel-quote"),
      text: String(quote?.text ?? ""),
    })),
  };
}
