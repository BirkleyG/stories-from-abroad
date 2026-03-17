import {
  browserLocalPersistence,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  setPersistence,
  signInWithEmailLink,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { app, db, firestoreReady } from "./firebaseClient";

const PENDING_KEY = "sfa-pending-subscriber-v1";

type PendingSubscriber = {
  email: string;
  name: string;
  preferences: string[];
  source: string;
};

type SubscriberFlags = {
  wantsAllUpdates: boolean;
  wantsPapers: boolean;
  wantsPhotography: boolean;
  wantsFaces: boolean;
  wantsTravel: boolean;
};

let authRef = null;
let authPersistencePromise: Promise<void> | null = null;

function getClientAuth() {
  if (typeof window === "undefined" || !app) return null;
  if (!authRef) {
    authRef = getAuth(app);
  }
  if (!authPersistencePromise) {
    authPersistencePromise = setPersistence(authRef, browserLocalPersistence).catch(() => undefined);
  }
  return authRef;
}

async function ensureAuthReady() {
  if (!getClientAuth()) return null;
  if (authPersistencePromise) await authPersistencePromise;
  return authRef;
}

function normalizeString(value: unknown) {
  return String(value ?? "").trim();
}

function toPreferenceList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(0, 10);
}

function flagsFromPreferences(value: unknown): SubscriberFlags {
  const preferences = new Set(toPreferenceList(value));
  return {
    wantsAllUpdates: preferences.has("all"),
    wantsPapers: preferences.has("articles") || preferences.has("papers"),
    wantsPhotography: preferences.has("photography"),
    wantsFaces: preferences.has("faces") || preferences.has("stories"),
    wantsTravel: preferences.has("travel"),
  };
}

function preferencesFromFlags(flags: SubscriberFlags) {
  const next = [];
  if (flags.wantsAllUpdates) next.push("all");
  if (flags.wantsPapers) next.push("articles");
  if (flags.wantsPhotography) next.push("photography");
  if (flags.wantsFaces) next.push("faces");
  if (flags.wantsTravel) next.push("travel");
  return next;
}

function readPendingSubscriber(): PendingSubscriber | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const email = normalizeEmail(parsed.email);
    if (!email) return null;
    return {
      email,
      name: normalizeString(parsed.name).slice(0, 80),
      preferences: toPreferenceList(parsed.preferences),
      source: normalizeString(parsed.source).slice(0, 40) || "subscriber_modal",
    };
  } catch (error) {
    return null;
  }
}

function writePendingSubscriber(next: PendingSubscriber) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_KEY, JSON.stringify(next));
  } catch (error) {
    // Ignore storage errors.
  }
}

function clearPendingSubscriber() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_KEY);
  } catch (error) {
    // Ignore storage errors.
  }
}

export function normalizeEmail(value: unknown) {
  return normalizeString(value).toLowerCase();
}

export function fallbackNameFromEmail(email: unknown) {
  const lower = normalizeEmail(email);
  const local = lower.split("@")[0] || "";
  if (!local) return "Subscriber";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function isSubscriberProfileActive(profile: unknown) {
  return Boolean(profile && typeof profile === "object" && (profile as { status?: string }).status === "active");
}

export async function getSubscriberRecord(uid: string) {
  if (!firestoreReady || !db || !uid) return null;
  try {
    const snap = await getDoc(doc(db, "subscribers", uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    return null;
  }
}

export async function upsertSubscriberRecord(
  user: User,
  options?: {
    name?: string;
    preferences?: string[];
    source?: string;
  }
) {
  if (!firestoreReady || !db || !user?.uid || !user.email) return null;

  const existing = await getSubscriberRecord(user.uid);
  const fallbackName = fallbackNameFromEmail(user.email);
  const nextName =
    normalizeString(options?.name) ||
    normalizeString((existing as { name?: string } | null)?.name) ||
    normalizeString(user.displayName) ||
    fallbackName;
  const nextPreferences = toPreferenceList(
    options?.preferences ?? (existing as { preferences?: unknown } | null)?.preferences ?? []
  );
  const existingFlags = {
    wantsAllUpdates: Boolean((existing as { wantsAllUpdates?: boolean } | null)?.wantsAllUpdates),
    wantsPapers: Boolean((existing as { wantsPapers?: boolean } | null)?.wantsPapers),
    wantsPhotography: Boolean((existing as { wantsPhotography?: boolean } | null)?.wantsPhotography),
    wantsFaces: Boolean((existing as { wantsFaces?: boolean } | null)?.wantsFaces),
    wantsTravel: Boolean((existing as { wantsTravel?: boolean } | null)?.wantsTravel),
  };
  const nextFlags = nextPreferences.length ? flagsFromPreferences(nextPreferences) : existingFlags;
  if (!nextPreferences.length) {
    nextPreferences.push(...preferencesFromFlags(existingFlags));
  }
  const source = normalizeString(options?.source) || normalizeString((existing as { source?: string } | null)?.source) || "subscriber_modal";
  const emailLower = normalizeEmail(user.email);

  const next: Record<string, unknown> = {
    email: user.email,
    emailLower,
    name: nextName.slice(0, 80),
    verified: true,
    status: "active",
    preferences: nextPreferences,
    wantsAllUpdates: nextFlags.wantsAllUpdates,
    wantsPapers: nextFlags.wantsPapers,
    wantsPhotography: nextFlags.wantsPhotography,
    wantsFaces: nextFlags.wantsFaces,
    wantsTravel: nextFlags.wantsTravel,
    source: source.slice(0, 40),
    updatedAt: serverTimestamp(),
  };

  if (!existing) {
    next.createdAt = serverTimestamp();
  }

  await setDoc(doc(db, "subscribers", user.uid), next, { merge: true });
  return next;
}

export async function sendSubscriberSignInLink(options: {
  email: string;
  name?: string;
  preferences?: string[];
  source?: string;
  redirectUrl?: string;
}) {
  const auth = await ensureAuthReady();
  const email = normalizeEmail(options.email);
  if (!auth || !email) {
    return { ok: false, reason: "auth_unavailable" as const };
  }

  if (!email.includes("@")) {
    return { ok: false, reason: "invalid_email" as const };
  }

  const existingUser = auth.currentUser;
  if (existingUser?.email && normalizeEmail(existingUser.email) === email) {
    await upsertSubscriberRecord(existingUser, {
      name: options.name,
      preferences: options.preferences,
      source: options.source,
    });
    return { ok: true, linked: true as const };
  }

  const redirectUrl =
    normalizeString(options.redirectUrl) ||
    (typeof window !== "undefined" ? window.location.href : "");
  if (!redirectUrl) {
    return { ok: false, reason: "missing_redirect" as const };
  }

  await sendSignInLinkToEmail(auth, email, {
    url: redirectUrl,
    handleCodeInApp: true,
  });

  writePendingSubscriber({
    email,
    name: normalizeString(options.name).slice(0, 80),
    preferences: toPreferenceList(options.preferences),
    source: normalizeString(options.source).slice(0, 40) || "subscriber_modal",
  });

  return { ok: true, linked: false as const };
}

export async function completeSubscriberSignInFromLink() {
  const auth = await ensureAuthReady();
  if (!auth || typeof window === "undefined") {
    return { completed: false as const };
  }

  const href = window.location.href;
  if (!isSignInWithEmailLink(auth, href)) {
    return { completed: false as const };
  }

  const pending = readPendingSubscriber();
  const pendingEmail = normalizeEmail(pending?.email);
  const fallbackEmail = normalizeEmail(window.localStorage.getItem("sfa-last-email-link") || "");
  const email = pendingEmail || fallbackEmail || normalizeEmail(window.prompt("Confirm your email to finish sign-in:") || "");
  if (!email) {
    return { completed: false as const, error: "missing_email" as const };
  }

  const credential = await signInWithEmailLink(auth, email, href);
  window.localStorage.setItem("sfa-last-email-link", email);

  await upsertSubscriberRecord(credential.user, {
    name: pending?.name,
    preferences: pending?.preferences,
    source: pending?.source || "subscriber_modal",
  });

  clearPendingSubscriber();

  try {
    const clean = new URL(window.location.href);
    clean.search = "";
    const cleanHref = clean.pathname + clean.hash;
    window.history.replaceState({}, document.title, cleanHref || "/");
  } catch (error) {
    // Ignore URL replacement errors.
  }

  return {
    completed: true as const,
    user: credential.user,
  };
}

export async function getCurrentAuthUser() {
  const auth = await ensureAuthReady();
  return auth?.currentUser ?? null;
}

export async function onSubscriberAuthChange(callback: (user: User | null) => void) {
  const auth = await ensureAuthReady();
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
}
