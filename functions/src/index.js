import admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { defineString } from "firebase-functions/params";
import { publishDraft, processScheduledKind, scheduleDraft, unpublishDraft } from "./publishers.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const bootstrapEmailsParam = defineString("ADMIN_BOOTSTRAP_EMAILS", { default: "" });

function allowedBootstrapEmails() {
  return bootstrapEmailsParam.value().split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  return request.auth;
}

function requireAdmin(request) {
  const auth = requireAuth(request);
  if (auth.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return auth;
}

async function getUserByEmail(email) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    throw new HttpsError("not-found", `No Firebase Auth user exists for ${email}.`);
  }
}

export const assignAdminClaim = onCall(async (request) => {
  const auth = requireAuth(request);
  const callerEmail = String(auth.token.email || "").trim().toLowerCase();
  const requestedEmail = String(request.data?.email || callerEmail).trim().toLowerCase();
  if (!requestedEmail) {
    throw new HttpsError("invalid-argument", "An email is required.");
  }

  const callerIsAdmin = auth.token?.admin === true;
  const bootstrapAllowed = allowedBootstrapEmails().includes(callerEmail);
  if (!callerIsAdmin && (!bootstrapAllowed || requestedEmail !== callerEmail)) {
    throw new HttpsError("permission-denied", "This account cannot bootstrap admin access.");
  }

  const user = await getUserByEmail(requestedEmail);
  await admin.auth().setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    admin: true,
  });

  return {
    email: requestedEmail,
    message: `Admin claim applied to ${requestedEmail}. Refresh the session token on the client.`,
  };
});

export const publishContent = onCall(async (request) => {
  const auth = requireAdmin(request);
  const kind = String(request.data?.kind || "");
  const id = String(request.data?.id || "");
  if (!kind || !id) {
    throw new HttpsError("invalid-argument", "Both kind and id are required.");
  }
  try {
    const result = await publishDraft(kind, id, String(auth.token.email || auth.uid || "admin"));
    return {
      ...result,
      message: `Published ${kind} ${id}.`,
    };
  } catch (error) {
    logger.error("publishContent failed", { kind, id, error: error.message });
    throw new HttpsError("internal", error.message || "Publish failed.");
  }
});

export const unpublishContent = onCall(async (request) => {
  const auth = requireAdmin(request);
  const kind = String(request.data?.kind || "");
  const id = String(request.data?.id || "");
  if (!kind || !id) {
    throw new HttpsError("invalid-argument", "Both kind and id are required.");
  }
  try {
    const result = await unpublishDraft(kind, id, String(auth.token.email || auth.uid || "admin"));
    return {
      ...result,
      message: `Unpublished ${kind} ${id}.`,
    };
  } catch (error) {
    logger.error("unpublishContent failed", { kind, id, error: error.message });
    throw new HttpsError("internal", error.message || "Unpublish failed.");
  }
});

export const schedulePublish = onCall(async (request) => {
  const auth = requireAdmin(request);
  const kind = String(request.data?.kind || "");
  const id = String(request.data?.id || "");
  const scheduledPublishAt = String(request.data?.scheduledPublishAt || "");
  if (!kind || !id || !scheduledPublishAt) {
    throw new HttpsError("invalid-argument", "kind, id, and scheduledPublishAt are required.");
  }
  try {
    const result = await scheduleDraft(kind, id, scheduledPublishAt, String(auth.token.email || auth.uid || "admin"));
    return {
      ...result,
      message: `Scheduled ${kind} ${id} for ${result.scheduledPublishAt}.`,
    };
  } catch (error) {
    logger.error("schedulePublish failed", { kind, id, error: error.message });
    throw new HttpsError("internal", error.message || "Schedule failed.");
  }
});

export const processScheduledPublishes = onSchedule("every 5 minutes", async () => {
  const nowIso = new Date().toISOString();
  let total = 0;
  for (const kind of ["faces", "papers", "travel"]) {
    try {
      const processed = await processScheduledKind(kind, nowIso);
      total += processed;
    } catch (error) {
      logger.error("Scheduled publish processing failed", { kind, error: error.message });
    }
  }
  logger.info("Scheduled publish cycle complete", { nowIso, total });
});
