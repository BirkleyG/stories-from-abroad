export const CONTENT_KINDS = ["faces", "papers", "travel", "photography"];
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
export const PHOTO_TEMPLATES = [
  { value: "desert-bloom", label: "Cinematic Narrative (Desert Bloom)" },
  { value: "desert-fill", label: "Photo-First Grid (Desert Fill)" },
  { value: "kyoto-bold", label: "Bold Sections (Kyoto Bold)" },
  { value: "tokyo-fragments", label: "Editorial Fragments (Tokyo Fragments)" },
];

export const PHOTO_TEMPLATE_OPTIONS = {
  "desert-bloom": {
    label: "Desert Bloom",
    theme: "Immersive editorial sequence with field notes and full-width pauses.",
    allowedBlocks: ["hero-photo", "photo-row", "text-note", "full-photo"],
  },
  "desert-fill": {
    label: "Desert Fill",
    theme: "Photo-first tiled composition with minimal text interruption.",
    allowedBlocks: ["hero-photo", "photo-row", "full-photo"],
  },
  "kyoto-bold": {
    label: "Kyoto Bold",
    theme: "Bold editorial sections with ghost text and title-led transitions.",
    allowedBlocks: ["hero-photo", "section-title", "photo-row", "ghost-text-row", "full-photo"],
  },
  "tokyo-fragments": {
    label: "Tokyo Fragments",
    theme: "Fragmented cinematic rhythm with alternating rows and widescreen breaks.",
    allowedBlocks: ["hero-photo", "photo-row", "ghost-text-row", "full-photo", "text-note"],
  },
};

export const PHOTO_BLOCK_PRESETS = {
  "hero-photo": {
    type: "hero-photo",
    label: "Hero Photo",
    description: "Opening frame for the fixed title overlay.",
    slots: 1,
  },
  "photo-row": {
    type: "photo-row",
    label: "Photo Row",
    description: "One or more photos presented together in a horizontal row.",
    slots: 3,
  },
  "text-note": {
    type: "text-note",
    label: "Text Note",
    description: "Editorial note / field note block between image sequences.",
    slots: 0,
  },
  "section-title": {
    type: "section-title",
    label: "Section Title",
    description: "Bold section break with kicker and heading.",
    slots: 0,
  },
  "ghost-text-row": {
    type: "ghost-text-row",
    label: "Ghost Text Row",
    description: "Photo row with oversized background text treatment.",
    slots: 2,
  },
  "full-photo": {
    type: "full-photo",
    label: "Full Photo",
    description: "Single immersive full-width frame.",
    slots: 1,
  },
};

export const ADMIN_COLLECTIONS = {
  faces: "admin_faces",
  papers: "admin_papers",
  travel: "admin_dispatches",
  photography: "admin_shoots",
  media: "media_assets",
};

export const SITE_CONFIG_COLLECTION = "site_config";
export const SITE_CONFIG_DOCS = {
  sectionMedia: "section_media",
  photographyFeatured: "photography_featured",
};

export const CONTENT_LABELS = {
  faces: "Faces of the World",
  papers: "Selected Papers",
  travel: "Travel Dispatches",
  photography: "Photography Shoots",
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
    locationLabel: "",
    shutter: "",
    aperture: "",
    iso: "",
    lens: "",
    metadataEnabled: true,
    shortQuote: "",
    storagePath: "",
    contentType: "",
    fileName: "",
    focusX: 50,
    focusY: 50,
    width: null,
    height: null,
    cameraModel: "",
    exifDate: "",
  };
}

export function createFaceBlock(type = "paragraph") {
  const base = { id: createLocalId("face-block"), type };
  if (type === "quote") return { ...base, text: "" };
  if (type === "qa") return { ...base, question: "", answer: "" };
  if (type === "photo") return { ...base, ...createMediaValue() };
  return { ...base, text: "" };
}

export function createPhotoBlock(type = "photo-row") {
  const preset = PHOTO_BLOCK_PRESETS[type] || PHOTO_BLOCK_PRESETS["photo-row"];
  const base = {
    id: createLocalId("photo-block"),
    type: preset.type,
  };

  if (type === "text-note") {
    return {
      ...base,
      noteLabel: "Field Note",
      title: "",
      text: "",
    };
  }

  if (type === "section-title") {
    return {
      ...base,
      tag: "",
      title: "",
      rightNote: "",
    };
  }

  if (type === "ghost-text-row") {
    return {
      ...base,
      ghostText: "",
      ghostPosition: "center",
      height: 540,
      photos: [createMediaValue(), createMediaValue()],
    };
  }

  if (type === "hero-photo") {
    return {
      ...base,
      photo: createMediaValue(),
      eyebrow: "",
    };
  }

  if (type === "full-photo") {
    return {
      ...base,
      height: 860,
      photo: createMediaValue(),
    };
  }

  return {
    ...base,
    height: 540,
    photos: Array.from({ length: preset.slots }, () => createMediaValue()),
  };
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

export function createEmptyPhotographyDraft() {
  return {
    kind: "photography",
    status: "draft",
    slug: "",
    title: "",
    description: "",
    shootDate: "",
    scheduledPublishAt: "",
    locationLabel: "",
    city: "",
    country: "",
    tagWord1: "",
    tagWord2: "",
    tagWord3: "",
    theme: "desert-bloom",
    accentColor: "#c96b28",
    template: "desert-bloom",
    cameraModel: "",
    frameCount: 0,
    photos: [createMediaValue()],
    notes: "",
    adminNotes: "",
    publishedRecord: null,
  };
}

export function createEmptyDraft(kind) {
  if (kind === "faces") return createEmptyFaceDraft();
  if (kind === "papers") return createEmptyPaperDraft();
  if (kind === "travel") return createEmptyTravelDraft();
  if (kind === "photography") return createEmptyPhotographyDraft();
  throw new Error(`Unsupported draft kind: ${kind}`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeMediaValue(value) {
  const base = createMediaValue();
  const merged = { ...base, ...(value || {}) };
  merged.metadataEnabled = merged.metadataEnabled !== false && String(merged.metadataEnabled) !== "false";
  merged.shortQuote = String(merged.shortQuote || "");
  merged.shutter = String(merged.shutter || "");
  merged.aperture = String(merged.aperture || "");
  merged.iso = String(merged.iso || "");
  merged.lens = String(merged.lens || "");
  return merged;
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

function normalizePhotoBlocks(blocks) {
  const source = Array.isArray(blocks) ? blocks : [];
  const normalized = source.map((block) => {
    if (!block || typeof block !== "object") return null;
    if (block.type === "text-note") {
      return {
        id: block.id || createLocalId("photo-block"),
        type: "text-note",
        noteLabel: String(block.noteLabel ?? "Field Note"),
        title: String(block.title ?? ""),
        text: String(block.text ?? ""),
      };
    }
    if (block.type === "section-title") {
      return {
        id: block.id || createLocalId("photo-block"),
        type: "section-title",
        tag: String(block.tag ?? ""),
        title: String(block.title ?? ""),
        rightNote: String(block.rightNote ?? ""),
      };
    }
    if (block.type === "ghost-text-row") {
      const photos = (Array.isArray(block.photos) ? block.photos : []).map(normalizeMediaValue);
      while (photos.length < 2) photos.push(createMediaValue());
      return {
        id: block.id || createLocalId("photo-block"),
        type: "ghost-text-row",
        ghostText: String(block.ghostText ?? ""),
        ghostPosition: String(block.ghostPosition ?? "center"),
        height: Number(block.height) || 540,
        photos,
      };
    }
    if (block.type === "hero-photo") {
      return {
        id: block.id || createLocalId("photo-block"),
        type: "hero-photo",
        eyebrow: String(block.eyebrow ?? ""),
        photo: normalizeMediaValue(block.photo || block),
      };
    }
    if (block.type === "full-photo") {
      return {
        id: block.id || createLocalId("photo-block"),
        type: "full-photo",
        height: Number(block.height) || 860,
        photo: normalizeMediaValue(block.photo || block),
      };
    }
    const photos = (Array.isArray(block.photos) ? block.photos : []).map(normalizeMediaValue);
    return {
      id: block.id || createLocalId("photo-block"),
      type: "photo-row",
      height: Number(block.height) || 540,
      photos: photos.length ? photos : [createMediaValue()],
    };
  }).filter(Boolean);
  return normalized.length ? normalized : [createPhotoBlock("hero-photo"), createPhotoBlock("photo-row")];
}

function flattenPhotoBlocksToMedia(blocks) {
  const photos = [];
  (normalizePhotoBlocks(blocks) || []).forEach((block) => {
    if (!block || typeof block !== "object") return;
    if ((block.type === "hero-photo" || block.type === "full-photo") && block.photo?.url) {
      photos.push(normalizeMediaValue(block.photo));
      return;
    }
    if ((block.type === "photo-row" || block.type === "ghost-text-row") && Array.isArray(block.photos)) {
      block.photos.forEach((photo) => {
        if (!photo?.url) return;
        photos.push(normalizeMediaValue(photo));
      });
    }
  });
  return photos;
}

function normalizePhotographyPhotos(photos, blocks) {
  const sourcePhotos = (Array.isArray(photos) ? photos : []).map(normalizeMediaValue);
  if (sourcePhotos.length) return sourcePhotos;
  const legacyPhotos = flattenPhotoBlocksToMedia(blocks);
  return legacyPhotos.length ? legacyPhotos : [createMediaValue()];
}

function normalizePhotographyTheme(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "editorial") return "tokyo-fragments";
  if (raw === "documentary") return "desert-fill";
  if (raw === "cinematic") return "desert-bloom";
  if (PHOTO_TEMPLATES.some((option) => option.value === raw)) return raw;
  return "desert-bloom";
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
  if (kind === "travel") {
    return {
      ...merged,
      photos: (Array.isArray(merged.photos) ? merged.photos : []).map(normalizeMediaValue).concat([]),
      quotes: (Array.isArray(merged.quotes) ? merged.quotes : []).map((quote) => ({
        id: quote?.id || createLocalId("travel-quote"),
        text: String(quote?.text ?? ""),
      })),
    };
  }
  const theme = normalizePhotographyTheme(merged.theme || merged.template);
  return {
    ...merged,
    description: String(merged.description ?? merged.notes ?? ""),
    tagWord1: String(merged.tagWord1 ?? ""),
    tagWord2: String(merged.tagWord2 ?? ""),
    tagWord3: String(merged.tagWord3 ?? ""),
    locationLabel: String(merged.locationLabel || [merged.city, merged.country].filter(Boolean).join(", ")),
    theme,
    template: theme,
    photos: normalizePhotographyPhotos(merged.photos, merged.blocks),
    adminNotes: String(merged.adminNotes || ""),
  };
}
