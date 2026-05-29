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
import { firebaseConfig, functionsRegion, app, db, firestoreReady } from "./firebaseClient";

const PENDING_KEY = "sfa-pending-subscriber-v1";
const PROFILE_CACHE_KEY = "sfa-subscriber-profile-v1";
const UI_STORAGE_KEY = "sfa-subscriber-ui-v1";
export const SUBSCRIBER_SEGMENTS = [
  "Articles & Op-Eds",
  "Photography",
  "Faces of the World",
  "Travel",
] as const;

const PREFERENCE_TO_SEGMENT: Record<string, (typeof SUBSCRIBER_SEGMENTS)[number]> = {
  articles: "Articles & Op-Eds",
  papers: "Articles & Op-Eds",
  photography: "Photography",
  photo: "Photography",
  faces: "Faces of the World",
  stories: "Faces of the World",
  travel: "Travel",
};

const SEGMENT_TO_PREFERENCE: Record<(typeof SUBSCRIBER_SEGMENTS)[number], string> = {
  "Articles & Op-Eds": "articles",
  Photography: "photography",
  "Faces of the World": "faces",
  Travel: "travel",
};

type PendingSubscriber = {
  email: string;
  name: string;
  preferences: string[];
  segmentTags?: string[];
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

function dedupeList<T>(items: T[]) {
  return Array.from(new Set(items));
}

function normalizeSegmentTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return dedupeList(
    value
      .map((item) => normalizeString(item))
      .filter((item): item is (typeof SUBSCRIBER_SEGMENTS)[number] =>
        (SUBSCRIBER_SEGMENTS as readonly string[]).includes(item)
      )
  );
}

function segmentsFromPreferences(value: unknown) {
  const preferences = toPreferenceList(value);
  if (preferences.includes("all")) return [...SUBSCRIBER_SEGMENTS];
  return dedupeList(
    preferences
      .map((item) => PREFERENCE_TO_SEGMENT[item])
      .filter(Boolean)
  );
}

function segmentsFromLegacyFlags(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const profile = value as SubscriberFlags;
  const next = [];
  if (profile.wantsAllUpdates) next.push(...SUBSCRIBER_SEGMENTS);
  if (profile.wantsPapers) next.push("Articles & Op-Eds");
  if (profile.wantsPhotography) next.push("Photography");
  if (profile.wantsFaces) next.push("Faces of the World");
  if (profile.wantsTravel) next.push("Travel");
  return dedupeList(next);
}

function segmentsFromSource(source: unknown) {
  const normalized = normalizeString(source).toLowerCase();
  if (!normalized) return [];
  if (normalized.includes("paper") || normalized.includes("article") || normalized.includes("op_ed")) return ["Articles & Op-Eds"];
  if (normalized.includes("photo")) return ["Photography"];
  if (normalized.includes("face")) return ["Faces of the World"];
  if (normalized.includes("travel") || normalized.includes("dispatch") || normalized.includes("comment")) return ["Travel"];
  return [];
}

function preferencesFromSegments(segments: string[]) {
  return dedupeList(
    segments
      .map((segment) => SEGMENT_TO_PREFERENCE[segment as (typeof SUBSCRIBER_SEGMENTS)[number]])
      .filter(Boolean)
  );
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

function flagsFromSegments(segments: string[]): SubscriberFlags {
  const set = new Set(segments);
  return {
    wantsAllUpdates: segments.length === SUBSCRIBER_SEGMENTS.length,
    wantsPapers: set.has("Articles & Op-Eds"),
    wantsPhotography: set.has("Photography"),
    wantsFaces: set.has("Faces of the World"),
    wantsTravel: set.has("Travel"),
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

function sanitizeCachedProfile(profile: unknown, fallbackEmail = "") {
  if (!profile || typeof profile !== "object") return null;
  const source = profile as Record<string, unknown>;
  const email = normalizeEmail(source.email || fallbackEmail);
  const segmentTags = normalizeSubscriberSegments(source);
  const preferences = toPreferenceList(source.preferences);
  return {
    email,
    name: normalizeString(source.name).slice(0, 80),
    preferences,
    segmentTags,
    status: normalizeString(source.status) || (segmentTags.length || preferences.length ? "active" : ""),
    wantsAllUpdates: Boolean(source.wantsAllUpdates),
    wantsPapers: Boolean(source.wantsPapers),
    wantsPhotography: Boolean(source.wantsPhotography),
    wantsFaces: Boolean(source.wantsFaces),
    wantsTravel: Boolean(source.wantsTravel),
  };
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
      segmentTags: normalizeSegmentTags(parsed.segmentTags),
      source: normalizeString(parsed.source).slice(0, 40) || "subscriber_modal",
    };
  } catch (error) {
    return null;
  }
}

function readSubscriberStateFromUrl(): PendingSubscriber | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URL(window.location.href).searchParams;
    const email = normalizeEmail(params.get("sfaSubEmail") || "");
    if (!email) return null;
    return {
      email,
      name: normalizeString(params.get("sfaSubName") || "").slice(0, 80),
      preferences: toPreferenceList((params.get("sfaSubPrefs") || "").split(",")),
      segmentTags: normalizeSegmentTags((params.get("sfaSubSegments") || "").split(",")),
      source: normalizeString(params.get("sfaSubSource") || "").slice(0, 40) || "subscriber_modal",
    };
  } catch (error) {
    return null;
  }
}

function redirectWithSubscriberState(redirectUrl: string, pending: PendingSubscriber) {
  try {
    const url = new URL(redirectUrl, typeof window !== "undefined" ? window.location.origin : undefined);
    url.searchParams.set("sfaSubEmail", pending.email);
    if (pending.name) url.searchParams.set("sfaSubName", pending.name);
    if (pending.preferences.length) url.searchParams.set("sfaSubPrefs", pending.preferences.join(","));
    if (pending.segmentTags?.length) url.searchParams.set("sfaSubSegments", pending.segmentTags.join(","));
    if (pending.source) url.searchParams.set("sfaSubSource", pending.source);
    return url.toString();
  } catch (error) {
    return redirectUrl;
  }
}

function getSubscriberEmailLinkEndpoint() {
  const projectId = normalizeString(firebaseConfig?.projectId);
  if (!projectId) return "";
  const region = normalizeString(functionsRegion) || "us-central1";
  return `https://${region}-${projectId}.cloudfunctions.net/sendSubscriberSignInLinkEmail`;
}

function getSubscriberSyncEndpoint() {
  const projectId = normalizeString(firebaseConfig?.projectId);
  if (!projectId) return "";
  const region = normalizeString(functionsRegion) || "us-central1";
  return `https://${region}-${projectId}.cloudfunctions.net/syncSubscriberByEmail`;
}

async function syncExistingSubscriberByEmail(pending: PendingSubscriber) {
  const endpoint = getSubscriberSyncEndpoint();
  if (!endpoint) return { ok: false as const, exists: false as const };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: pending.email,
      name: pending.name,
      segmentTags: pending.segmentTags || [],
      source: pending.source,
    }),
  });
  if (!response.ok) {
    return { ok: false as const, exists: false as const };
  }
  const payload = await response.json().catch(() => ({}));
  const exists = Boolean(payload?.exists);
  const updated = Boolean(payload?.updated);
  const profile = payload?.profile && typeof payload.profile === "object" ? payload.profile : null;
  return {
    ok: true as const,
    exists,
    updated,
    profile,
  };
}

async function sendCustomSubscriberSignInEmail(pending: PendingSubscriber, redirectUrl: string) {
  const endpoint = getSubscriberEmailLinkEndpoint();
  if (!endpoint) return false;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: pending.email,
      name: pending.name,
      redirectUrl: redirectWithSubscriberState(redirectUrl, pending),
    }),
  });
  if (!response.ok) {
    let message = "Custom sign-in email failed.";
    try {
      const payload = await response.json();
      if (payload?.message) message = String(payload.message);
    } catch (error) {
      // Ignore response parsing errors.
    }
    throw new Error(message);
  }
  return true;
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

export function normalizeSubscriberSegments(profile: unknown) {
  if (!profile || typeof profile !== "object") return [];
  const source = profile as Record<string, unknown>;
  const direct = normalizeSegmentTags(source.segmentTags);
  if (direct.length) return direct;
  return dedupeList([
    ...segmentsFromPreferences(source.preferences),
    ...segmentsFromLegacyFlags(source),
  ]);
}

export function subscriberHasSegment(profile: unknown, segment: string) {
  return isSubscriberProfileActive(profile) && normalizeSubscriberSegments(profile).includes(segment as any);
}

export function subscriberHasAnySegment(profile: unknown) {
  return isSubscriberProfileActive(profile) && normalizeSubscriberSegments(profile).length > 0;
}

export function readCachedSubscriberProfile() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const rawProfile = parsed?.profile && typeof parsed.profile === "object" ? parsed.profile : parsed;
    const profile = sanitizeCachedProfile(rawProfile, parsed?.email);
    if (!profile?.email?.includes("@")) return null;
    return {
      email: profile.email,
      profile,
      segmentTags: profile.segmentTags,
      updatedAt: Number((parsed as { updatedAt?: unknown }).updatedAt || 0) || 0,
    };
  } catch (error) {
    return null;
  }
}

export function cacheSubscriberProfile(input: { email?: unknown; user?: Partial<User> | null; profile?: unknown }) {
  if (typeof window === "undefined") return null;
  const user = input.user || null;
  const profile = sanitizeCachedProfile(input.profile || {}, normalizeEmail(input.email || user?.email || ""));
  const email = normalizeEmail(input.email || user?.email || profile?.email || "");
  if (!email.includes("@")) return null;
  const nextProfile = {
    ...(profile || {}),
    email,
    name: normalizeString(profile?.name || user?.displayName || "").slice(0, 80),
    status: profile?.status || "active",
    segmentTags: normalizeSubscriberSegments(profile),
    preferences: toPreferenceList(profile?.preferences),
  };
  const payload = {
    email,
    profile: nextProfile,
    name: nextProfile.name,
    preferences: nextProfile.preferences,
    segmentTags: nextProfile.segmentTags,
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(payload));
    window.localStorage.setItem(UI_STORAGE_KEY, subscriberHasAnySegment(nextProfile) ? "profile" : "subscribe");
  } catch (error) {
    // Ignore storage errors.
  }
  emitSubscriberProfileMode(email, nextProfile);
  return payload;
}

export function emitSubscriberProfileMode(emailInput: unknown, profile: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent("sfa:subscriber-profile-mode", {
      detail: {
        email: normalizeEmail(emailInput || (profile as { email?: unknown } | null)?.email || ""),
        profile: profile && typeof profile === "object" ? profile : null,
      },
    }));
  } catch (error) {
    // Ignore event errors.
  }
}

export function setSubscriberUiModeFromProfile(profile: unknown) {
  if (typeof window === "undefined") return;
  const subscribed = subscriberHasAnySegment(profile);
  try {
    window.localStorage.setItem(UI_STORAGE_KEY, subscribed ? "profile" : "subscribe");
  } catch (error) {
    // Ignore storage errors.
  }
  document.documentElement.setAttribute("data-sfa-ui", subscribed ? "profile" : "subscribe");
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
    segmentTags?: string[];
    source?: string;
    replaceSegments?: boolean;
  }
) {
  if (!firestoreReady || !db || !user?.uid || !user.email) return null;

  const existing = await getSubscriberRecord(user.uid);
  const nextName =
    normalizeString(options?.name) ||
    normalizeString((existing as { name?: string } | null)?.name) ||
    normalizeString(user.displayName);
  const nextPreferences = toPreferenceList(
    options?.preferences ?? (existing as { preferences?: unknown } | null)?.preferences ?? []
  );
  const source = normalizeString(options?.source) || normalizeString((existing as { source?: string } | null)?.source) || "subscriber_modal";
  const nextSegments = normalizeSegmentTags(options?.segmentTags);
  const existingSegments = normalizeSegmentTags((existing as { segmentTags?: unknown } | null)?.segmentTags);
  const existingFlags = {
    wantsAllUpdates: Boolean((existing as { wantsAllUpdates?: boolean } | null)?.wantsAllUpdates),
    wantsPapers: Boolean((existing as { wantsPapers?: boolean } | null)?.wantsPapers),
    wantsPhotography: Boolean((existing as { wantsPhotography?: boolean } | null)?.wantsPhotography),
    wantsFaces: Boolean((existing as { wantsFaces?: boolean } | null)?.wantsFaces),
    wantsTravel: Boolean((existing as { wantsTravel?: boolean } | null)?.wantsTravel),
  };
  const replaceSegments = Boolean(options?.replaceSegments);
  const segmentTags = replaceSegments
    ? dedupeList([
        ...nextSegments,
        ...segmentsFromPreferences(nextPreferences),
      ])
    : dedupeList([
        ...nextSegments,
        ...segmentsFromPreferences(nextPreferences),
        ...existingSegments,
        ...segmentsFromLegacyFlags(existingFlags),
        ...segmentsFromSource(source),
      ]);
  const preferences = nextPreferences.length
    ? dedupeList(nextPreferences)
    : preferencesFromSegments(segmentTags).length
      ? preferencesFromSegments(segmentTags)
      : preferencesFromFlags(existingFlags);
  const nextFlags = segmentTags.length ? flagsFromSegments(segmentTags) : flagsFromPreferences(preferences);
  const emailLower = normalizeEmail(user.email);

  const next: Record<string, unknown> = {
    email: user.email,
    emailLower,
    name: nextName.slice(0, 80),
    verified: true,
    status: "active",
    preferences,
    segmentTags,
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
  segmentTags?: string[];
  source?: string;
  redirectUrl?: string;
  forceEmailLink?: boolean;
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
    const profile = await upsertSubscriberRecord(existingUser, {
      name: options.name,
      preferences: options.preferences,
      segmentTags: options.segmentTags,
      source: options.source,
    });
    cacheSubscriberProfile({ user: existingUser, profile });
    return { ok: true, linked: true as const, existing: true as const, updated: true as const, profile };
  }

  const redirectUrl =
    normalizeString(options.redirectUrl) ||
    (typeof window !== "undefined" ? window.location.href : "");
  if (!redirectUrl) {
    return { ok: false, reason: "missing_redirect" as const };
  }

  const pending = {
    email,
    name: normalizeString(options.name).slice(0, 80),
    preferences: toPreferenceList(options.preferences),
    segmentTags: normalizeSegmentTags(options.segmentTags),
    source: normalizeString(options.source).slice(0, 40) || "subscriber_modal",
  };

  if (!options.forceEmailLink) {
    try {
      const syncResult = await syncExistingSubscriberByEmail(pending);
      if (syncResult.ok && syncResult.exists) {
        if (syncResult.profile) {
          cacheSubscriberProfile({ email, profile: syncResult.profile });
        }
        return {
          ok: true,
          linked: false as const,
          existing: true as const,
          updated: syncResult.updated,
          profile: syncResult.profile,
        };
      }
    } catch (error) {
      // Fall through to normal email-link flow.
    }
  }

  let sentViaCustomService = false;
  try {
    sentViaCustomService = await sendCustomSubscriberSignInEmail(pending, redirectUrl);
  } catch (error) {
    sentViaCustomService = false;
  }
  if (!sentViaCustomService) {
    await sendSignInLinkToEmail(auth, email, {
      url: redirectWithSubscriberState(redirectUrl, pending),
      handleCodeInApp: true,
    });
  }

  writePendingSubscriber(pending);

  return { ok: true, linked: false as const, existing: false as const, updated: false as const };
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

  const pending = readPendingSubscriber() || readSubscriberStateFromUrl();
  const pendingEmail = normalizeEmail(pending?.email);
  const fallbackEmail = normalizeEmail(window.localStorage.getItem("sfa-last-email-link") || "");
  const email = pendingEmail || fallbackEmail || normalizeEmail(window.prompt("Confirm your email to finish sign-in:") || "");
  if (!email) {
    return { completed: false as const, error: "missing_email" as const };
  }

  let credential;
  try {
    credential = await signInWithEmailLink(auth, email, href);
  } catch (error: any) {
    if (error?.code === "auth/invalid-action-code" || error?.code === "auth/expired-action-code") {
      try {
        const clean = new URL(window.location.href);
        clean.search = "";
        const cleanHref = clean.pathname + clean.hash;
        window.history.replaceState({}, document.title, cleanHref || "/");
      } catch (innerError) {
        // Ignore URL replacement errors.
      }
      return { completed: false as const, error: "invalid_action_code" as const };
    }
    throw error;
  }
  window.localStorage.setItem("sfa-last-email-link", email);

  const profile = await upsertSubscriberRecord(credential.user, {
    name: pending?.name,
    preferences: pending?.preferences,
    segmentTags: pending?.segmentTags,
    source: pending?.source || "subscriber_modal",
  });
  cacheSubscriberProfile({ user: credential.user, profile });

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

export async function lookupSubscriberByEmail(emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (!email.includes("@")) return { ok: false as const, exists: false as const, profile: null };
  const pending: PendingSubscriber = {
    email,
    name: "",
    preferences: [],
    segmentTags: [],
    source: "subscriber_lookup",
  };
  try {
    const result = await syncExistingSubscriberByEmail(pending);
    return {
      ok: result.ok,
      exists: Boolean(result.exists),
      profile: result.profile || null,
    };
  } catch (error) {
    return {
      ok: false as const,
      exists: false as const,
      profile: null,
    };
  }
}
