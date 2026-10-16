// Privacy-light analytics + email delivery tracking.
//
//  - trackEvent    : batched engagement beacon (see analyticsModel.js) -> daily rollups in `analytics_daily`
//  - emailOpen     : 1x1 pixel embedded in broadcast emails -> opens on `email_recipients` / `email_sends`
//  - resendWebhook : optional Resend webhook -> delivered / bounced / complained / clicked status
//
// No IPs, cookies or user agents are stored. "Unique" counts come from first-today flags kept in the
// visitor's own localStorage; the server never sees a visitor id.

import crypto from "node:crypto";
import admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { buildAnalyticsUpdate } from "./analyticsModel.js";

export const resendWebhookSecretParam = defineSecret("RESEND_WEBHOOK_SECRET");

const PIXEL_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function db() {
  return admin.firestore();
}

function inc(n = 1) {
  return admin.firestore.FieldValue.increment(n);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString("utf8")); } catch { return {}; }
  }
  return typeof req.body === "object" ? req.body : {};
}

export const trackEvent = onRequest({ maxInstances: 10, cors: true }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.status(405).send("");
    return;
  }
  try {
    const built = buildAnalyticsUpdate(parseBody(req), { inc });
    if (built) await db().collection("analytics_daily").doc(built.id).set(built.update, { merge: true });
  } catch (error) {
    logger.error("trackEvent failed", { error: error.message });
  }
  res.status(204).send("");
});

export const emailOpen = onRequest({ maxInstances: 10 }, async (req, res) => {
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.set("Pragma", "no-cache");
  try {
    const sendId = String(req.query.s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
    const recipientId = String(req.query.r || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
    if (sendId && recipientId) {
      const recipientRef = db().collection("email_recipients").doc(`${sendId}_${recipientId}`);
      const snap = await recipientRef.get();
      if (snap.exists && snap.data()?.sendId === sendId) {
        const FieldValue = admin.firestore.FieldValue;
        const first = !snap.data().openedAt;
        await recipientRef.set({
          opens: inc(),
          openedAt: snap.data().openedAt || FieldValue.serverTimestamp(),
          lastOpenedAt: FieldValue.serverTimestamp(),
          engagement: "opened",
        }, { merge: true });
        await db().collection("email_sends").doc(sendId).set({
          opens: inc(),
          ...(first ? { uniqueOpens: inc() } : {}),
        }, { merge: true });
      }
    }
  } catch (error) {
    logger.error("emailOpen failed", { error: error.message });
  }
  res.status(200).send(PIXEL_GIF);
});

function verifySvix(req, secret) {
  const id = req.headers["svix-id"];
  const timestamp = req.headers["svix-timestamp"];
  const signatureHeader = String(req.headers["svix-signature"] || "");
  if (!id || !timestamp || !signatureHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 10) return false;
  const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
  const key = Buffer.from(String(secret).replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${raw}`).digest("base64");
  return signatureHeader.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig || sig.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}

const EVENT_STATUS = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

export const resendWebhook = onRequest({ secrets: [resendWebhookSecretParam], maxInstances: 5 }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("");
    return;
  }
  try {
    const secret = resendWebhookSecretParam.value();
    if (!secret || !verifySvix(req, secret)) {
      res.status(401).json({ error: "invalid-signature" });
      return;
    }
    const event = parseBody(req);
    const type = String(event.type || "");
    const emailId = String(event.data?.email_id || "");
    if (!emailId) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const found = await db().collection("email_recipients").where("resendId", "==", emailId).limit(1).get();
    if (found.empty) {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }
    const recipientRef = found.docs[0].ref;
    const recipient = found.docs[0].data();
    const sendRef = db().collection("email_sends").doc(recipient.sendId);
    const FieldValue = admin.firestore.FieldValue;

    if (EVENT_STATUS[type]) {
      const status = EVENT_STATUS[type];
      const alreadyFinal = ["bounced", "complained"].includes(recipient.status);
      await recipientRef.set({
        status: alreadyFinal ? recipient.status : status,
        statusAt: FieldValue.serverTimestamp(),
        ...(status === "bounced" || status === "failed" ? { error: String(event.data?.bounce?.message || event.data?.reason || "").slice(0, 300) } : {}),
      }, { merge: true });
      const counter = { delivered: "delivered", bounced: "bounced", complained: "complained" }[status];
      if (counter && recipient.status !== status) await sendRef.set({ [counter]: inc() }, { merge: true });
    } else if (type === "email.opened") {
      const first = !recipient.openedAt;
      await recipientRef.set({
        opens: inc(),
        openedAt: recipient.openedAt || FieldValue.serverTimestamp(),
        lastOpenedAt: FieldValue.serverTimestamp(),
        engagement: recipient.clickedAt ? "clicked" : "opened",
      }, { merge: true });
      // Own pixel already counts opens when present; only add webhook opens for unique-open fallback.
      if (first && !recipient.opens) await sendRef.set({ uniqueOpens: inc(), opens: inc() }, { merge: true });
    } else if (type === "email.clicked") {
      const first = !recipient.clickedAt;
      await recipientRef.set({
        clicks: inc(),
        clickedAt: recipient.clickedAt || FieldValue.serverTimestamp(),
        engagement: "clicked",
      }, { merge: true });
      await sendRef.set({ clicks: inc(), ...(first ? { uniqueClicks: inc() } : {}) }, { merge: true });
    }
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error("resendWebhook failed", { error: error.message });
    res.status(500).json({ error: "internal" });
  }
});
