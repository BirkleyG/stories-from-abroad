import { doc, getDoc } from "firebase/firestore";
import { db, firestoreReady } from "./firebaseClient";

export function normalizeSiteMediaAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  const url = String(asset.url || "").trim();
  if (!url) return null;
  return {
    url,
    alt: String(asset.alt || "").trim(),
    title: String(asset.title || "").trim(),
    caption: String(asset.caption || "").trim(),
  };
}

export async function loadSectionMediaConfig() {
  if (!firestoreReady || !db) return {};
  try {
    const snapshot = await getDoc(doc(db, "site_config", "section_media"));
    if (!snapshot.exists()) return {};
    const data = snapshot.data() || {};
    return {
      readStoryPortrait: normalizeSiteMediaAsset(data.readStoryPortrait),
      papersHeroImage: normalizeSiteMediaAsset(data.papersHeroImage),
      papersAuthorPortrait: normalizeSiteMediaAsset(data.papersAuthorPortrait),
    };
  } catch (error) {
    console.warn("Section media config unavailable.", error);
    return {};
  }
}
