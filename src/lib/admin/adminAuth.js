import {
  getIdTokenResult,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
} from "firebase/auth";
import { auth, firebaseReady } from "../firebaseClient";

const STORAGE_KEY = "stories-from-abroad-admin-email";

function assertAuthReady() {
  if (!firebaseReady || !auth) {
    throw new Error("Firebase Auth is not configured for this site.");
  }
}

export function getStoredAdminEmail() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_KEY) || "";
}

export async function sendAdminSignInLink(email) {
  assertAuthReady();
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
  const actionUrl = typeof window !== "undefined"
    ? window.location.href.split("?")[0].split("#")[0]
    : "/admin";
  await sendSignInLinkToEmail(auth, normalized, {
    url: actionUrl,
    handleCodeInApp: true,
  });
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }
  return normalized;
}

export async function completeAdminSignIn(currentUrl, fallbackEmail = "") {
  assertAuthReady();
  const targetUrl = currentUrl || (typeof window !== "undefined" ? window.location.href : "");
  if (!isSignInWithEmailLink(auth, targetUrl)) return null;
  const storedEmail = getStoredAdminEmail();
  const email = String(fallbackEmail || storedEmail || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Open the admin sign-in link on the same device you requested it from, or enter the same email again.");
  }
  const result = await signInWithEmailLink(auth, email, targetUrl);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
    const cleanUrl = targetUrl.split("?")[0].split("#")[0];
    window.history.replaceState({}, document.title, cleanUrl);
  }
  return result.user;
}

export function onAdminAuthChange(callback) {
  assertAuthReady();
  return onAuthStateChanged(auth, callback);
}

export async function getAdminSession(user, forceRefresh = false) {
  assertAuthReady();
  if (!user) return { user: null, claims: {}, isAdmin: false };
  const token = await getIdTokenResult(user, forceRefresh);
  return {
    user,
    claims: token.claims || {},
    isAdmin: Boolean(token.claims?.admin),
  };
}

export async function signOutAdmin() {
  assertAuthReady();
  await signOut(auth);
}
