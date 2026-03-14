import {
  addDoc,
  collection,
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
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, firestoreReady, storage } from "../firebaseClient";
import { buildVersionSnapshot, prepareDraftForSave } from "./contentAdapters";
import { ADMIN_COLLECTIONS, CONTENT_KINDS, createEmptyDraft, hydrateDraft } from "./schemas";

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
    storagePath: bucketPath,
    url,
    alt: "",
    caption: "",
    title: "",
    createdAt: serverTimestamp(),
    createdBy: actor(user),
  });
  const asset = await getDoc(assetRef);
  return { id: assetRef.id, ...asset.data() };
}
