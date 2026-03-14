import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

const functionsRegion = import.meta.env.PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1";
const firebaseReady = Object.values(firebaseConfig).every(Boolean);
const firestoreReady = firebaseReady;

let app = null;
let db = null;
let auth = null;
let storage = null;
let functions = null;

if (firebaseReady) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  db = getFirestore(app);
  if (typeof window !== "undefined") {
    auth = getAuth(app);
    storage = getStorage(app);
    functions = getFunctions(app, functionsRegion);
  }
}

export { app, auth, db, firebaseConfig, firebaseReady, firestoreReady, functions, functionsRegion, storage };
