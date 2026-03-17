import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, firestoreReady, storage } from "../firebaseClient";
import { buildVersionSnapshot, prepareDraftForSave } from "./contentAdapters";
import { ADMIN_COLLECTIONS, CONTENT_KINDS, createEmptyDraft, hydrateDraft, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS } from "./schemas";

function assertFirestoreReady() {
  if (!firestoreReady || !db) {
    throw new Error("Firestore is not configured for this site.");
  }
}

function assertStorageReady() {
  if (!storage) {
    throw new Error("Firebase Storage is not configured for this site.");
  }
}

function collectionName(kind) {
  if (kind === "media") return ADMIN_COLLECTIONS.media;
  if (!CONTENT_KINDS.includes(kind)) {
    throw new Error(`Unsupported content kind: ${kind}`);
  }
  return ADMIN_COLLECTIONS[kind];
}

function sanitize(value) {
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, sanitize(entry)])
    );
  }
  return value;
}

function actor(user) {
  return user?.email || user?.uid || "admin";
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function fileExtension(fileName = "") {
  const match = String(fileName).match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function assetTitleFromFileName(fileName = "") {
  const base = String(fileName).replace(/\.[^/.]+$/, "");
  if (!base) return "";
  const normalized = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function readImageDimensions(file) {
  if (typeof window === "undefined" || !(file?.type || "").startsWith("image/")) {
    return {};
  }

  try {
    if (typeof window.createImageBitmap === "function") {
      const bitmap = await window.createImageBitmap(file);
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        bitmap.close();
      }
    }

    return await new Promise((resolve) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(objectUrl);
      };
      image.onerror = () => {
        resolve({});
        URL.revokeObjectURL(objectUrl);
      };
      image.src = objectUrl;
    });
  } catch {
    return {};
  }
}

async function extractUploadMetadata(file) {
  const dimensions = await readImageDimensions(file);
  return sanitize({
    extension: fileExtension(file?.name || ""),
    lastModifiedAt: file?.lastModified ? new Date(file.lastModified).toISOString() : "",
    width: dimensions.width,
    height: dimensions.height,
  });
}

export function subscribeDraftList(kind, callback, onError) {
  assertFirestoreReady();
  const coll = collection(db, collectionName(kind));
  return onSnapshot(
    query(coll, orderBy("updatedAt", "desc")),
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    },
    onError
  );
}

export function subscribeMediaAssets(callback, onError) {
  assertFirestoreReady();
  return onSnapshot(
    query(collection(db, ADMIN_COLLECTIONS.media), orderBy("createdAt", "desc"), limit(48)),
    (snapshot) => callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError
  );
}

export function subscribeSectionMediaConfig(callback, onError) {
  assertFirestoreReady();
  return onSnapshot(doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.sectionMedia), (snapshot) => {
    callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : {});
  }, onError);
}

export function subscribePhotographyFeaturedConfig(callback, onError) {
  assertFirestoreReady();
  return onSnapshot(doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.photographyFeatured), (snapshot) => {
    callback(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { items: [] });
  }, onError);
}

export async function getDraft(kind, id) {
  assertFirestoreReady();
  const snapshot = await getDoc(doc(db, collectionName(kind), id));
  if (!snapshot.exists()) return null;
  return hydrateDraft(kind, { id: snapshot.id, ...snapshot.data() });
}

export async function listVersions(kind, id) {
  assertFirestoreReady();
  const snapshot = await getDocs(query(collection(db, collectionName(kind), id, "versions"), orderBy("createdAt", "desc"), limit(25)));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export async function createDraft(kind, user) {
  assertFirestoreReady();
  const ref = doc(collection(db, collectionName(kind)));
  const initial = sanitize({
    id: ref.id,
    kind,
    ...prepareDraftForSave(kind, createEmptyDraft(kind)),
    createdBy: actor(user),
    updatedBy: actor(user),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const batch = writeBatch(db);
  batch.set(ref, initial);
  batch.set(doc(collection(ref, "versions")), {
    reason: "created",
    createdAt: serverTimestamp(),
    createdBy: actor(user),
    snapshot: buildVersionSnapshot(kind, createEmptyDraft(kind)),
  });
  await batch.commit();
  return ref.id;
}

export async function saveDraft(kind, id, draft, user, options = {}) {
  assertFirestoreReady();
  const prepared = prepareDraftForSave(kind, draft);
  const ref = doc(db, collectionName(kind), id);
  const payload = sanitize({
    ...prepared,
    id,
    kind,
    updatedBy: actor(user),
    updatedAt: serverTimestamp(),
  });
  const batch = writeBatch(db);
  batch.set(ref, payload, { merge: true });
  if (options.captureVersion) {
    batch.set(doc(collection(ref, "versions")), {
      reason: options.reason || "manual-save",
      createdAt: serverTimestamp(),
      createdBy: actor(user),
      snapshot: buildVersionSnapshot(kind, prepared),
    });
  }
  await batch.commit();
  return payload;
}

export async function restoreVersion(kind, id, versionId, user) {
  assertFirestoreReady();
  const versionRef = doc(db, collectionName(kind), id, "versions", versionId);
  const versionSnap = await getDoc(versionRef);
  if (!versionSnap.exists()) {
    throw new Error("Version not found.");
  }
  const snapshot = versionSnap.data()?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Version snapshot is empty.");
  }
  await saveDraft(kind, id, snapshot, user, {
    captureVersion: true,
    reason: `restore:${versionId}`,
  });
  return hydrateDraft(kind, snapshot);
}

export async function uploadMediaAsset(file, user, context = {}) {
  assertFirestoreReady();
  assertStorageReady();
  const safeName = String(file?.name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const extractedMetadata = await extractUploadMetadata(file);
  const bucketPath = ["admin", context.kind || "misc", `${Date.now()}-${safeName}`].join("/");
  const storageRef = ref(storage, bucketPath);
  await uploadBytes(storageRef, file, {
    contentType: file.type || "application/octet-stream",
    customMetadata: {
      owner: actor(user),
      kind: String(context.kind || "misc"),
      field: String(context.field || ""),
    },
  });
  const url = await getDownloadURL(storageRef);
  const assetRef = await addDoc(collection(db, ADMIN_COLLECTIONS.media), {
    kind: String(context.kind || "misc"),
    field: String(context.field || ""),
    fileName: safeName,
    originalName: String(file.name || safeName),
    contentType: file.type || "application/octet-stream",
    size: Number(file.size || 0),
    ...extractedMetadata,
    storagePath: bucketPath,
    url,
    alt: "",
    caption: "",
    title: assetTitleFromFileName(file.name || safeName),
    locationLabel: "",
    cameraModel: "",
    exifDate: "",
    createdAt: serverTimestamp(),
    createdBy: actor(user),
    updatedAt: serverTimestamp(),
    updatedBy: actor(user),
  });
  const asset = await getDoc(assetRef);
  return { id: assetRef.id, ...asset.data() };
}

export async function updateMediaAsset(id, updates, user) {
  assertFirestoreReady();
  const assetRef = doc(db, ADMIN_COLLECTIONS.media, id);
  const payload = sanitize({
    alt: cleanText(updates.alt),
    caption: cleanText(updates.caption),
    title: cleanText(updates.title),
    locationLabel: cleanText(updates.locationLabel),
    kind: cleanText(updates.kind),
    field: cleanText(updates.field),
    updatedAt: serverTimestamp(),
    updatedBy: actor(user),
  });
  await setDoc(assetRef, payload, { merge: true });
  const asset = await getDoc(assetRef);
  return asset.exists() ? { id: asset.id, ...asset.data() } : null;
}

export async function deleteDraft(kind, id) {
  assertFirestoreReady();
  const draftRef = doc(db, collectionName(kind), id);
  const versionsSnap = await getDocs(collection(draftRef, "versions"));
  const batch = writeBatch(db);
  versionsSnap.forEach((versionDoc) => batch.delete(versionDoc.ref));
  batch.delete(draftRef);
  await batch.commit();
}

export async function saveSectionMediaConfig(config, user) {
  assertFirestoreReady();
  const ref = doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.sectionMedia);
  const payload = sanitize({
    readStoryPortrait: config?.readStoryPortrait || null,
    papersHeroImage: config?.papersHeroImage || null,
    papersAuthorPortrait: config?.papersAuthorPortrait || null,
    updatedAt: serverTimestamp(),
    updatedBy: actor(user),
  });
  await setDoc(ref, payload, { merge: true });
  const snapshot = await getDoc(ref);
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : {};
}

export async function savePhotographyFeaturedConfig(config, user) {
  assertFirestoreReady();
  const ref = doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.photographyFeatured);
  const payload = sanitize({
    items: Array.isArray(config?.items)
      ? config.items
        .map((item) => ({
          shootId: cleanText(item?.shootId),
          shootSlug: cleanText(item?.shootSlug),
          shootTitle: cleanText(item?.shootTitle),
          photoId: cleanText(item?.photoId),
          photoUrl: cleanText(item?.photoUrl),
          photoAlt: cleanText(item?.photoAlt),
          locationLabel: cleanText(item?.locationLabel),
          accentColor: cleanText(item?.accentColor),
          caption: cleanText(item?.caption),
        }))
        .filter((item) => item.shootId && item.photoId && item.photoUrl)
      : [],
    updatedAt: serverTimestamp(),
    updatedBy: actor(user),
  });
  await setDoc(ref, payload, { merge: true });
  const snapshot = await getDoc(ref);
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : { items: [] };
}

function mediaMatchesTarget(value, target) {
  return Boolean(
    value
    && typeof value === "object"
    && (
      (target.assetId && String(value.assetId || "") === target.assetId)
      || (target.url && String(value.url || "") === target.url)
      || (target.storagePath && String(value.storagePath || "") === target.storagePath)
    )
  );
}

function findMediaReferences(value, target, path = "root", matches = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findMediaReferences(item, target, `${path}[${index}]`, matches));
    return matches;
  }
  if (value && typeof value === "object") {
    if (mediaMatchesTarget(value, target)) {
      matches.push(path);
    }
    Object.entries(value).forEach(([key, entry]) => {
      findMediaReferences(entry, target, path === "root" ? key : `${path}.${key}`, matches);
    });
  }
  return matches;
}

async function collectCollectionUsages(collectionName, target, label) {
  const snapshot = await getDocs(collection(db, collectionName));
  const usages = [];
  snapshot.docs.forEach((item) => {
    const paths = findMediaReferences(item.data(), target, "root", []);
    if (paths.length) {
      usages.push({
        label,
        docId: item.id,
        paths,
      });
    }
  });
  return usages;
}

export async function findMediaAssetUsages(asset) {
  assertFirestoreReady();
  const target = {
    assetId: String(asset?.id || asset?.assetId || ""),
    url: String(asset?.url || ""),
    storagePath: String(asset?.storagePath || ""),
  };

  const [faces, papers, travel, photography, publicFaces, publicPapers, publicTravel, publicPhotography, sectionMediaSnap, photographyFeaturedSnap] = await Promise.all([
    collectCollectionUsages(ADMIN_COLLECTIONS.faces, target, "Faces drafts"),
    collectCollectionUsages(ADMIN_COLLECTIONS.papers, target, "Papers drafts"),
    collectCollectionUsages(ADMIN_COLLECTIONS.travel, target, "Travel drafts"),
    collectCollectionUsages(ADMIN_COLLECTIONS.photography, target, "Photography drafts"),
    collectCollectionUsages("faces", target, "Published Faces"),
    collectCollectionUsages("papers", target, "Published Papers"),
    collectCollectionUsages("scrap_sheet_posts", target, "Published Travel"),
    collectCollectionUsages("photo_shoots", target, "Published Photography"),
    getDoc(doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.sectionMedia)),
    getDoc(doc(db, SITE_CONFIG_COLLECTION, SITE_CONFIG_DOCS.photographyFeatured)),
  ]);

  const siteAssets = [];
  if (sectionMediaSnap.exists()) {
    const paths = findMediaReferences(sectionMediaSnap.data(), target, "root", []);
    if (paths.length) {
      siteAssets.push({
        label: "Site assets",
        docId: sectionMediaSnap.id,
        paths,
      });
    }
  }

  if (photographyFeaturedSnap.exists()) {
    const paths = findMediaReferences(photographyFeaturedSnap.data(), target, "root", []);
    if (paths.length) {
      siteAssets.push({
        label: "Photography featured",
        docId: photographyFeaturedSnap.id,
        paths,
      });
    }
  }

  return [...faces, ...papers, ...travel, ...photography, ...publicFaces, ...publicPapers, ...publicTravel, ...publicPhotography, ...siteAssets];
}

export async function deleteMediaAsset(asset, user) {
  assertFirestoreReady();
  assertStorageReady();
  const usages = await findMediaAssetUsages(asset);
  if (usages.length) {
    const summary = usages.map((usage) => `${usage.label} (${usage.docId} -> ${usage.paths.join(", ")})`).join("; ");
    throw new Error(`This media is still in use: ${summary}`);
  }

  if (asset?.storagePath) {
    await deleteObject(ref(storage, asset.storagePath));
  }
  await deleteDoc(doc(db, ADMIN_COLLECTIONS.media, String(asset.id || asset.assetId || "")));
  return {
    id: String(asset.id || asset.assetId || ""),
    deletedBy: actor(user),
  };
}
