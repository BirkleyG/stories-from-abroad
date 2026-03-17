import { httpsCallable } from "firebase/functions";
import { auth, firebaseConfig, functions, functionsRegion, firebaseReady } from "../firebaseClient";

function getCallable(name) {
  if (!firebaseReady || !functions) {
    throw new Error("Cloud Functions are not configured for this site.");
  }
  return httpsCallable(functions, name);
}

function getHttpFunctionUrl(name) {
  if (!firebaseReady || !firebaseConfig?.projectId) {
    throw new Error("Cloud Functions are not configured for this site.");
  }
  return `https://${functionsRegion}-${firebaseConfig.projectId}.cloudfunctions.net/${name}`;
}

export async function assignAdminClaim(payload = {}) {
  if (!auth?.currentUser) {
    throw new Error("You must be signed in before claiming admin access.");
  }

  const token = await auth.currentUser.getIdToken(true);
  const response = await fetch(getHttpFunctionUrl("assignAdminClaimHttp"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || {}),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.message || data.error || "Admin claim could not be assigned.");
  }

  return data;
}

export async function publishDraft(kind, id) {
  const callable = getCallable("publishContent");
  const result = await callable({ kind, id });
  return result.data;
}

export async function unpublishDraft(kind, id) {
  const callable = getCallable("unpublishContent");
  const result = await callable({ kind, id });
  return result.data;
}

export async function scheduleDraft(kind, id, scheduledPublishAt) {
  const callable = getCallable("schedulePublish");
  const result = await callable({ kind, id, scheduledPublishAt });
  return result.data;
}

export async function repairCoordinates() {
  const callable = getCallable("repairCoordinates");
  const result = await callable({});
  return result.data;
}
