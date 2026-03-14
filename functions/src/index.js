import admin from "firebase-admin";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
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

function applyCors(res, origin = "*") {
  res.set("Access-Control-Allow-Origin", origin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

function readRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return typeof req.body === "object" ? req.body : {};
}

function extractBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
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

export const assignAdminClaimHttp = onRequest(async (req, res) => {
  const origin = String(req.headers.origin || "*");
  applyCors(res, origin);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method-not-allowed", message: "Use POST." });
    return;
  }

  try {
    const bearerToken = extractBearerToken(req);
    if (!bearerToken) {
      res.status(401).json({ error: "unauthenticated", message: "Authentication is required." });
      return;
    }

    const decoded = await admin.auth().verifyIdToken(bearerToken, true);
    const callerEmail = String(decoded.email || "").trim().toLowerCase();
    const body = readRequestBody(req);
    const requestedEmail = String(body.email || callerEmail).trim().toLowerCase();

    if (!requestedEmail) {
      res.status(400).json({ error: "invalid-argument", message: "An email is required." });
      return;
    }

    const callerIsAdmin = decoded.admin === true;
    const bootstrapAllowed = allowedBootstrapEmails().includes(callerEmail);
    if (!callerIsAdmin && (!bootstrapAllowed || requestedEmail !== callerEmail)) {
      res.status(403).json({ error: "permission-denied", message: "This account cannot bootstrap admin access." });
      return;
    }

    const user = await admin.auth().getUserByEmail(requestedEmail);
    await admin.auth().setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      admin: true,
    });

    res.status(200).json({
      email: requestedEmail,
      message: `Admin claim applied to ${requestedEmail}. Refresh the session token on the client.`,
    });
  } catch (error) {
    logger.error("assignAdminClaimHttp failed", { error: error.message });
    res.status(500).json({
      error: "internal",
      message: error.message || "Admin claim could not be assigned.",
    });
  }
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
