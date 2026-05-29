import admin from "firebase-admin";
import nodemailer from "nodemailer";
import { setGlobalOptions } from "firebase-functions/v2";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { defineSecret, defineString } from "firebase-functions/params";
import { publishDraft, processScheduledKind, repairCoordinateData, scheduleDraft, unpublishDraft } from "./publishers.js";

if (!admin.apps.length) {
  admin.initializeApp();
}

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const bootstrapEmailsParam = defineString("ADMIN_BOOTSTRAP_EMAILS", { default: "" });
const authEmailProviderParam = defineString("AUTH_EMAIL_PROVIDER", { default: "gmail_smtp" });
const resendApiKeyParam = defineSecret("RESEND_API_KEY");
const gmailSmtpAppPasswordParam = defineSecret("GMAIL_SMTP_APP_PASSWORD");
const gmailSmtpUserParam = defineString("GMAIL_SMTP_USER", { default: "" });
const authSenderEmailParam = defineString("AUTH_EMAIL_FROM", { default: "" });
const authReplyToEmailParam = defineString("AUTH_EMAIL_REPLY_TO", { default: "" });
const authSenderNameParam = defineString("AUTH_EMAIL_SENDER_NAME", { default: "Stories from Abroad" });
const SUBSCRIBER_SEGMENTS = ["Articles & Op-Eds", "Photography", "Faces of the World", "Travel"];

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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function dedupeList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeSegmentTags(value) {
  if (!Array.isArray(value)) return [];
  return dedupeList(
    value
      .map((item) => normalizeText(item, 40))
      .filter((segment) => SUBSCRIBER_SEGMENTS.includes(segment))
  );
}

function preferencesFromSegments(segmentTags) {
  const map = {
    "Articles & Op-Eds": "articles",
    Photography: "photography",
    "Faces of the World": "faces",
    Travel: "travel",
  };
  const base = segmentTags.map((segment) => map[segment]).filter(Boolean);
  if (segmentTags.length === SUBSCRIBER_SEGMENTS.length) return dedupeList(["all", ...base]);
  return dedupeList(base);
}

function segmentFlags(segmentTags) {
  const set = new Set(segmentTags);
  return {
    wantsAllUpdates: segmentTags.length === SUBSCRIBER_SEGMENTS.length,
    wantsPapers: set.has("Articles & Op-Eds"),
    wantsPhotography: set.has("Photography"),
    wantsFaces: set.has("Faces of the World"),
    wantsTravel: set.has("Travel"),
  };
}

function normalizeSenderEmail(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/<([^>]+)>/);
  return normalizeEmail(match ? match[1] : raw);
}

function normalizeActionUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    throw new HttpsError("invalid-argument", "A redirect URL is required.");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", "The redirect URL is invalid.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpsError("invalid-argument", "Redirect URL must be http or https.");
  }
  return parsed.toString();
}

function sanitizeFromHeader(rawSenderName, rawSenderEmail) {
  const senderName = normalizeText(rawSenderName || "Stories from Abroad", 80).replace(/["<>]/g, "");
  const senderEmail = normalizeSenderEmail(rawSenderEmail);
  if (!senderEmail.includes("@")) {
    throw new HttpsError("failed-precondition", "AUTH_EMAIL_FROM is not configured.");
  }
  return `${senderName} <${senderEmail}>`;
}

function buildSubscriberSignInEmail({ name, signInLink }) {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const plain = [
    greeting,
    "",
    "Tap the link below to confirm your Stories from Abroad subscription:",
    signInLink,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");

  const escapedLink = signInLink.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const escapedGreeting = greeting.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `
<div style="font-family:Georgia,'Times New Roman',serif;line-height:1.6;color:#1f2328;padding:20px;">
  <p style="margin:0 0 14px;">${escapedGreeting}</p>
  <p style="margin:0 0 14px;">Tap the link below to confirm your <strong>Stories from Abroad</strong> subscription.</p>
  <p style="margin:0 0 18px;">
    <a href="${escapedLink}" style="display:inline-block;background:#1f2328;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;">Confirm Subscription</a>
  </p>
  <p style="margin:0 0 10px;font-size:13px;color:#57606a;">If the button does not work, copy and paste this link:</p>
  <p style="margin:0 0 14px;word-break:break-all;font-size:13px;"><a href="${escapedLink}">${escapedLink}</a></p>
  <p style="margin:0;font-size:13px;color:#57606a;">If you did not request this, you can ignore this email.</p>
</div>`;

  return {
    subject: "Confirm your Stories from Abroad subscription",
    html,
    text: plain,
  };
}

async function sendViaResend({ apiKey, from, replyTo, to, subject, html, text }) {
  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
  };
  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "Resend rejected the message.";
    throw new Error(message);
  }

  return data;
}

async function sendViaGmailSmtp({ smtpUser, smtpPassword, from, replyTo, to, subject, html, text }) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  });

  const info = await transporter.sendMail({
    from,
    to,
    replyTo,
    subject,
    text,
    html,
  });

  return { id: info?.messageId || null };
}

function resolveEmailProvider() {
  const provider = normalizeText(authEmailProviderParam.value(), 40).toLowerCase();
  if (provider === "resend") return "resend";
  return "gmail_smtp";
}

export const sendSubscriberSignInLinkEmail = onRequest({ secrets: [resendApiKeyParam, gmailSmtpAppPasswordParam] }, async (req, res) => {
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
    const body = readRequestBody(req);
    const email = normalizeEmail(body.email);
    if (!email.includes("@")) {
      res.status(400).json({ error: "invalid-argument", message: "A valid email is required." });
      return;
    }

    const redirectUrl = normalizeActionUrl(body.redirectUrl);
    const senderName = authSenderNameParam.value();
    const senderEmail = authSenderEmailParam.value();
    const from = sanitizeFromHeader(senderName, senderEmail);
    const replyTo = normalizeSenderEmail(authReplyToEmailParam.value() || senderEmail);
    const provider = resolveEmailProvider();

    const signInLink = await admin.auth().generateSignInWithEmailLink(email, {
      url: redirectUrl,
      handleCodeInApp: true,
    });

    const template = buildSubscriberSignInEmail({
      name: normalizeText(body.name, 80),
      signInLink,
    });

    let result = null;
    if (provider === "resend") {
      const resendApiKey = resendApiKeyParam.value();
      if (!resendApiKey) {
        throw new HttpsError("failed-precondition", "RESEND_API_KEY is not configured.");
      }
      result = await sendViaResend({
        apiKey: resendApiKey,
        from,
        replyTo: replyTo.includes("@") ? replyTo : undefined,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    } else {
      const smtpUser = normalizeSenderEmail(gmailSmtpUserParam.value() || senderEmail);
      const smtpPassword = String(gmailSmtpAppPasswordParam.value() || "").trim();
      if (!smtpUser.includes("@")) {
        throw new HttpsError("failed-precondition", "GMAIL_SMTP_USER is not configured.");
      }
      if (!smtpPassword) {
        throw new HttpsError("failed-precondition", "GMAIL_SMTP_APP_PASSWORD is not configured.");
      }
      result = await sendViaGmailSmtp({
        smtpUser,
        smtpPassword,
        from,
        replyTo: replyTo.includes("@") ? replyTo : undefined,
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
    }

    res.status(200).json({
      ok: true,
      provider,
      id: result?.id || null,
    });
  } catch (error) {
    logger.error("sendSubscriberSignInLinkEmail failed", { error: error.message });
    const status = error instanceof HttpsError
      ? (error.httpErrorCode?.status || 400)
      : 500;
    res.status(status).json({
      error: error instanceof HttpsError ? error.code : "internal",
      message: error.message || "Email could not be sent.",
    });
  }
});

export const syncSubscriberByEmail = onRequest(async (req, res) => {
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
    const body = readRequestBody(req);
    const email = normalizeEmail(body.email);
    if (!email.includes("@")) {
      res.status(400).json({ ok: false, error: "invalid-argument", message: "A valid email is required." });
      return;
    }

    const incomingSegments = normalizeSegmentTags(body.segmentTags);
    const source = normalizeText(body.source, 40) || "subscriber_modal";
    const proposedName = normalizeText(body.name, 80);

    const matches = await admin.firestore()
      .collection("subscribers")
      .where("emailLower", "==", email)
      .limit(1)
      .get();

    if (matches.empty) {
      res.status(200).json({ ok: true, exists: false, updated: false, profile: null });
      return;
    }

    const docSnap = matches.docs[0];
    const current = docSnap.data() || {};
    const existingSegments = normalizeSegmentTags(current.segmentTags);
    const mergedSegments = dedupeList([...existingSegments, ...incomingSegments]);
    const existingName = normalizeText(current.name, 80);
    const nextName = proposedName || existingName;
    const changedSegments = mergedSegments.length !== existingSegments.length;
    const changedName = Boolean(proposedName && proposedName !== existingName);

    if (changedSegments || changedName) {
      const flags = segmentFlags(mergedSegments);
      const preferences = preferencesFromSegments(mergedSegments);
      await docSnap.ref.set({
        email: current.email || email,
        emailLower: email,
        name: nextName,
        verified: true,
        status: "active",
        preferences,
        segmentTags: mergedSegments,
        wantsAllUpdates: flags.wantsAllUpdates,
        wantsPapers: flags.wantsPapers,
        wantsPhotography: flags.wantsPhotography,
        wantsFaces: flags.wantsFaces,
        wantsTravel: flags.wantsTravel,
        source: source || normalizeText(current.source, 40) || "subscriber_modal",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const profile = {
      email,
      name: nextName,
      segmentTags: mergedSegments,
      preferences: changedSegments ? preferencesFromSegments(mergedSegments) : (Array.isArray(current.preferences) ? current.preferences : preferencesFromSegments(mergedSegments)),
      status: "active",
    };

    res.status(200).json({
      ok: true,
      exists: true,
      updated: changedSegments || changedName,
      profile,
    });
  } catch (error) {
    logger.error("syncSubscriberByEmail failed", { error: error.message });
    res.status(500).json({
      ok: false,
      error: "internal",
      message: error.message || "Unable to sync subscriber.",
    });
  }
});

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

export const repairCoordinates = onCall(async (request) => {
  const auth = requireAdmin(request);
  try {
    const result = await repairCoordinateData(String(auth.token.email || auth.uid || "admin"));
    return {
      ...result,
      message: `Repaired ${result.total} coordinate record(s).`,
    };
  } catch (error) {
    logger.error("repairCoordinates failed", { error: error.message });
    throw new HttpsError("internal", error.message || "Coordinate repair failed.");
  }
});

export const processScheduledPublishes = onSchedule("every 5 minutes", async () => {
  const nowIso = new Date().toISOString();
  let total = 0;
  for (const kind of ["faces", "papers", "travel", "photography"]) {
    try {
      const processed = await processScheduledKind(kind, nowIso);
      total += processed;
    } catch (error) {
      logger.error("Scheduled publish processing failed", { kind, error: error.message });
    }
  }
  logger.info("Scheduled publish cycle complete", { nowIso, total });
});
