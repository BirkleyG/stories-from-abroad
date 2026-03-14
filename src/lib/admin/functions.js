import { httpsCallable } from "firebase/functions";
import { functions, firebaseReady } from "../firebaseClient";

function getCallable(name) {
  if (!firebaseReady || !functions) {
    throw new Error("Cloud Functions are not configured for this site.");
  }
  return httpsCallable(functions, name);
}

export async function assignAdminClaim(payload = {}) {
  const callable = getCallable("assignAdminClaim");
  const result = await callable(payload);
  return result.data;
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
