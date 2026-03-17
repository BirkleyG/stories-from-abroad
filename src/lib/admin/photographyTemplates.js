import { PHOTO_TEMPLATE_OPTIONS, createPhotoBlock } from "./schemas";

export const GHOST_POSITIONS = [
  { value: "top-left", label: "Top left" },
  { value: "center", label: "Center" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

export function getTemplateDefinition(template) {
  return PHOTO_TEMPLATE_OPTIONS[template] || PHOTO_TEMPLATE_OPTIONS["desert-bloom"];
}

export function createPhotographyBlockFromTemplate(template, type) {
  const definition = getTemplateDefinition(template);
  if (!definition.allowedBlocks.includes(type)) {
    throw new Error(`Block ${type} is not allowed for ${template}.`);
  }
  return createPhotoBlock(type);
}

export function mediaSummaryFromBlocks(blocks = []) {
  const photos = [];
  (blocks || []).forEach((block) => {
    if (!block || typeof block !== "object") return;
    if ((block.type === "hero-photo" || block.type === "full-photo") && block.photo?.url) {
      photos.push(block.photo);
    }
    if ((block.type === "photo-row" || block.type === "ghost-text-row") && Array.isArray(block.photos)) {
      block.photos.filter((photo) => photo?.url).forEach((photo) => photos.push(photo));
    }
  });
  const cameraModel = photos.find((photo) => photo?.cameraModel)?.cameraModel || "";
  return {
    frames: photos.length,
    cameraModel,
    photos,
  };
}

export function collectFeaturedPhotoOptions(shoots = []) {
  return (Array.isArray(shoots) ? shoots : []).flatMap((shoot) => {
    const blocks = Array.isArray(shoot?.publishedRecord?.blocks) ? shoot.publishedRecord.blocks : [];
    const photos = [];
    blocks.forEach((block) => {
      if ((block?.type === "hero-photo" || block?.type === "full-photo") && block.photo?.url) {
        photos.push({
          shootId: shoot.id,
          shootSlug: shoot.publishedRecord?.slug || shoot.slug || "",
          shootTitle: shoot.title || "Untitled shoot",
          photoId: `${block.id}-0`,
          photoUrl: block.photo.url,
          photoAlt: block.photo.alt || block.photo.caption || shoot.title || "Photograph",
          locationLabel: block.photo.locationLabel || shoot.locationLabel || "",
          accentColor: shoot.accentColor || shoot.publishedRecord?.accentColor || "#c96b28",
          caption: block.photo.caption || "",
        });
      }
      if ((block?.type === "photo-row" || block?.type === "ghost-text-row") && Array.isArray(block.photos)) {
        block.photos.forEach((photo, index) => {
          if (!photo?.url) return;
          photos.push({
            shootId: shoot.id,
            shootSlug: shoot.publishedRecord?.slug || shoot.slug || "",
            shootTitle: shoot.title || "Untitled shoot",
            photoId: `${block.id}-${index}`,
            photoUrl: photo.url,
            photoAlt: photo.alt || photo.caption || shoot.title || "Photograph",
            locationLabel: photo.locationLabel || shoot.locationLabel || "",
            accentColor: shoot.accentColor || shoot.publishedRecord?.accentColor || "#c96b28",
            caption: photo.caption || "",
          });
        });
      }
    });
    return photos;
  });
}
