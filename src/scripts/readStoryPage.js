import { loadSectionMediaConfig } from "../lib/siteSectionMedia";

async function initReadStoryPage() {
  const portrait = document.getElementById("read-story-portrait");
  if (!portrait) return;

  const config = await loadSectionMediaConfig();
  const asset = config?.readStoryPortrait;
  if (!asset?.url) return;

  portrait.innerHTML = "";
  const image = document.createElement("img");
  image.src = asset.url;
  image.alt = asset.alt || "Stories From Abroad portrait";
  image.loading = "lazy";
  portrait.appendChild(image);
}

initReadStoryPage();
