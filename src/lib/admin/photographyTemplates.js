function flattenLegacyBlocks(blocks = []) {
  const photos = [];
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    if (!block || typeof block !== "object") return;
    if ((block.type === "hero-photo" || block.type === "full-photo") && block.photo?.url) {
      photos.push({ id: `${block.id || "legacy"}-0`, ...block.photo });
      return;
    }
    if ((block.type === "photo-row" || block.type === "ghost-text-row") && Array.isArray(block.photos)) {
      block.photos.forEach((photo, index) => {
        if (!photo?.url) return;
        photos.push({ id: `${block.id || "legacy"}-${index}`, ...photo });
      });
    }
  });
  return photos;
}

function normalizeShootPhotos(shoot) {
  if (Array.isArray(shoot?.allPhotos) && shoot.allPhotos.length) return shoot.allPhotos.filter((photo) => photo?.url);
  if (Array.isArray(shoot?.photos) && shoot.photos.length) return shoot.photos.filter((photo) => photo?.url);
  if (Array.isArray(shoot?.publishedRecord?.allPhotos) && shoot.publishedRecord.allPhotos.length) {
    return shoot.publishedRecord.allPhotos.filter((photo) => photo?.url);
  }
  const publishedBlocks = Array.isArray(shoot?.publishedRecord?.blocks) ? shoot.publishedRecord.blocks : [];
  const blocks = Array.isArray(shoot?.blocks) ? shoot.blocks : publishedBlocks;
  return flattenLegacyBlocks(blocks);
}

export function mediaSummaryFromPhotos(photos = []) {
  const cleaned = (Array.isArray(photos) ? photos : []).filter((photo) => photo?.url);
  const cameraModel = cleaned.find((photo) => photo?.cameraModel)?.cameraModel || "";
  return {
    frames: cleaned.length,
    cameraModel,
    photos: cleaned,
  };
}

export function collectFeaturedPhotoOptions(shoots = []) {
  return (Array.isArray(shoots) ? shoots : []).flatMap((shoot) => {
    const photos = normalizeShootPhotos(shoot);
    return photos.map((photo, index) => ({
      shootId: shoot.id,
      shootSlug: shoot.publishedRecord?.slug || shoot.slug || "",
      shootTitle: shoot.title || "Untitled shoot",
      photoId: String(photo.id || `${shoot.id || "shoot"}-${index}`),
      photoUrl: photo.url,
      photoAlt: photo.alt || photo.caption || shoot.title || "Photograph",
      locationLabel: photo.locationLabel || shoot.locationLabel || "",
      accentColor: shoot.accentColor || shoot.publishedRecord?.accentColor || "#c96b28",
      caption: photo.caption || "",
      photoTitle: photo.title || "",
      width: Number.isFinite(Number(photo.width)) ? Number(photo.width) : null,
      height: Number.isFinite(Number(photo.height)) ? Number(photo.height) : null,
    })).filter((photo) => photo.photoUrl);
  });
}
