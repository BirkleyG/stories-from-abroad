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

function readAscii(view, offset, length) {
  const chars = [];
  const max = Math.max(0, Math.min(length, view.byteLength - offset));
  for (let index = 0; index < max; index += 1) {
    chars.push(String.fromCharCode(view.getUint8(offset + index)));
  }
  return chars.join("");
}

function exifTypeWidth(type) {
  if (type === 1 || type === 2 || type === 7) return 1;
  if (type === 3) return 2;
  if (type === 4 || type === 9) return 4;
  if (type === 5 || type === 10) return 8;
  return 0;
}

function readExifValue(view, tiffStart, entryOffset, littleEndian) {
  const type = view.getUint16(entryOffset + 2, littleEndian);
  const count = view.getUint32(entryOffset + 4, littleEndian);
  const width = exifTypeWidth(type);
  if (!width || !count) return null;
  const valueBytes = width * count;
  const inlineOffset = entryOffset + 8;
  const pointer = view.getUint32(entryOffset + 8, littleEndian);
  const dataOffset = valueBytes <= 4 ? inlineOffset : tiffStart + pointer;
  if (dataOffset < 0 || dataOffset + valueBytes > view.byteLength) return null;

  const readSingle = (offset) => {
    if (type === 1 || type === 7) return view.getUint8(offset);
    if (type === 2) return String.fromCharCode(view.getUint8(offset));
    if (type === 3) return view.getUint16(offset, littleEndian);
    if (type === 4) return view.getUint32(offset, littleEndian);
    if (type === 5) {
      const numerator = view.getUint32(offset, littleEndian);
      const denominator = view.getUint32(offset + 4, littleEndian);
      return denominator ? numerator / denominator : null;
    }
    if (type === 9) return view.getInt32(offset, littleEndian);
    if (type === 10) {
      const numerator = view.getInt32(offset, littleEndian);
      const denominator = view.getInt32(offset + 4, littleEndian);
      return denominator ? numerator / denominator : null;
    }
    return null;
  };

  if (type === 2) {
    return readAscii(view, dataOffset, count).replace(/\0/g, "").trim();
  }

  if (count === 1) {
    return readSingle(dataOffset);
  }

  const values = [];
  for (let index = 0; index < count; index += 1) {
    values.push(readSingle(dataOffset + index * width));
  }
  return values;
}

function parseExifDate(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const match = text.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function formatExposure(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  if (number >= 1) {
    return `${number.toFixed(number % 1 ? 1 : 0)}s`;
  }
  const reciprocal = Math.round(1 / number);
  return reciprocal > 0 ? `1/${reciprocal}s` : "";
}

function formatAperture(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const fixed = number >= 10 ? number.toFixed(0) : number.toFixed(1);
  return `f/${fixed}`;
}

async function readExifMetadata(file) {
  const contentType = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  const looksLikeJpeg = contentType.includes("jpeg") || contentType.includes("jpg") || /\.jpe?g$/i.test(name);
  if (typeof window === "undefined" || !looksLikeJpeg) {
    return {};
  }
  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) {
      return {};
    }

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      const marker = view.getUint8(offset + 1);
      offset += 2;
      if (marker === 0xD9 || marker === 0xDA) break;
      if (offset + 2 > view.byteLength) break;
      const size = view.getUint16(offset, false);
      if (size < 2 || offset + size > view.byteLength) break;

      if (marker === 0xE1 && readAscii(view, offset + 2, 6) === "Exif\0\0") {
        const tiffStart = offset + 8;
        if (tiffStart + 8 > view.byteLength) return {};
        const byteOrder = readAscii(view, tiffStart, 2);
        const littleEndian = byteOrder === "II";
        if (!littleEndian && byteOrder !== "MM") return {};
        const ifd0Offset = view.getUint32(tiffStart + 4, littleEndian);
        const ifd0Pointer = tiffStart + ifd0Offset;
        if (ifd0Pointer + 2 > view.byteLength) return {};

        const tags = {};
        const readIfd = (ifdPointer) => {
          if (ifdPointer + 2 > view.byteLength) return;
          const count = view.getUint16(ifdPointer, littleEndian);
          for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
            const entryOffset = ifdPointer + 2 + entryIndex * 12;
            if (entryOffset + 12 > view.byteLength) break;
            const tag = view.getUint16(entryOffset, littleEndian);
            tags[tag] = readExifValue(view, tiffStart, entryOffset, littleEndian);
          }
        };

        readIfd(ifd0Pointer);
        const exifPointer = Number(tags[0x8769] || 0);
        if (Number.isFinite(exifPointer) && exifPointer > 0) {
          readIfd(tiffStart + exifPointer);
        }

        return sanitize({
          cameraModel: cleanText(tags[0x0110]),
          exifDate: parseExifDate(tags[0x9003] || tags[0x0132]),
          shutter: formatExposure(tags[0x829A]),
          aperture: formatAperture(tags[0x829D]),
          iso: cleanText(tags[0x8827]),
          lens: cleanText(tags[0xA434]),
        });
      }

      offset += size;
    }
    return {};
  } catch {
    return {};
  }
}

async function extractUploadMetadata(file) {
  const [dimensions, exif] = await Promise.all([readImageDimensions(file), readExifMetadata(file)]);
  return sanitize({
    extension: fileExtension(file?.name || ""),
    lastModifiedAt: file?.lastModified ? new Date(file.lastModified).toISOString() : "",
    width: dimensions.width,
    height: dimensions.height,
    cameraModel: cleanText(exif.cameraModel),
    exifDate: cleanText(exif.exifDate),
    shutter: cleanText(exif.shutter),
    aperture: cleanText(exif.aperture),
    iso: cleanText(exif.iso),
    lens: cleanText(exif.lens),
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
    cameraModel: cleanText(extractedMetadata.cameraModel),
    exifDate: cleanText(extractedMetadata.exifDate),
    shutter: cleanText(extractedMetadata.shutter),
    aperture: cleanText(extractedMetadata.aperture),
    iso: cleanText(extractedMetadata.iso),
    lens: cleanText(extractedMetadata.lens),
    metadataEnabled: true,
    shortQuote: "",
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
    alt: updates?.alt !== undefined ? cleanText(updates.alt) : undefined,
    caption: updates?.caption !== undefined ? cleanText(updates.caption) : undefined,
    title: updates?.title !== undefined ? cleanText(updates.title) : undefined,
    locationLabel: updates?.locationLabel !== undefined ? cleanText(updates.locationLabel) : undefined,
    cameraModel: updates?.cameraModel !== undefined ? cleanText(updates.cameraModel) : undefined,
    exifDate: updates?.exifDate !== undefined ? cleanText(updates.exifDate) : undefined,
    shutter: updates?.shutter !== undefined ? cleanText(updates.shutter) : undefined,
    aperture: updates?.aperture !== undefined ? cleanText(updates.aperture) : undefined,
    iso: updates?.iso !== undefined ? cleanText(updates.iso) : undefined,
    lens: updates?.lens !== undefined ? cleanText(updates.lens) : undefined,
    metadataEnabled: updates?.metadataEnabled !== undefined ? updates.metadataEnabled !== false : undefined,
    shortQuote: updates?.shortQuote !== undefined ? cleanText(updates.shortQuote) : undefined,
    kind: updates?.kind !== undefined ? cleanText(updates.kind) : undefined,
    field: updates?.field !== undefined ? cleanText(updates.field) : undefined,
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
    based: cleanText(config?.based),
    studying: cleanText(config?.studying),
    shooting: cleanText(config?.shooting),
    reading: cleanText(config?.reading),
    email: cleanText(config?.email),
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
          photoTitle: cleanText(item?.photoTitle || item?.title),
          width: Number.isFinite(Number(item?.width)) ? Number(item.width) : null,
          height: Number.isFinite(Number(item?.height)) ? Number(item.height) : null,
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
