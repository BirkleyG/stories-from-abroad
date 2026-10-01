import { createHash, timingSafeEqual } from "node:crypto";
import admin from "firebase-admin";
import { PROTECTED_AUDIENCES, PROTECTED_WRITING_COLLECTION } from "./publishers.js";

export const WRITING_INVITES_COLLECTION = "writing_invites";
const ATTEMPTS_COLLECTION = "writing_invite_attempts";
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 20;

export function normalizeInviteCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.ip || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

async function isThrottled(key) {
  const snap = await admin.firestore().collection(ATTEMPTS_COLLECTION).doc(key).get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  if (Date.now() - Number(data.windowStart || 0) > ATTEMPT_WINDOW_MS) return false;
  return Number(data.count || 0) >= MAX_FAILED_ATTEMPTS;
}

async function recordFailure(key) {
  const ref = admin.firestore().collection(ATTEMPTS_COLLECTION).doc(key);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const fresh = !snap.exists || Date.now() - Number(data.windowStart || 0) > ATTEMPT_WINDOW_MS;
    tx.set(ref, { windowStart: fresh ? Date.now() : data.windowStart, count: fresh ? 1 : Number(data.count || 0) + 1 });
  });
}

function toPublicPaper(id, data) {
  const { shareKey, collection, ...rest } = data || {};
  return { id, ...rest };
}

async function findByIdOrSlug(audience, token) {
  const coll = admin.firestore().collection(PROTECTED_WRITING_COLLECTION);
  const byId = await coll.doc(token).get();
  if (byId.exists && byId.data()?.collection === audience) return byId;
  const bySlug = await coll.where("slug", "==", token).limit(5).get();
  return bySlug.docs.find((doc) => doc.data()?.collection === audience) || null;
}

/**
 * POST { collection: "drafts"|"unpublished", code } -> every piece in that collection
 * POST { collection, paper, key }                    -> only the one piece the share link points to
 */
export async function handleGetProtectedWriting(req, res, { applyCors, readRequestBody }) {
  applyCors(res, String(req.headers.origin || "*"));
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "method-not-allowed" });

  const body = readRequestBody(req);
  const audience = String(body.collection || "");
  if (!PROTECTED_AUDIENCES.includes(audience)) {
    return res.status(400).json({ error: "invalid-argument", message: "Unknown collection." });
  }

  const key = clientKey(req);
  if (await isThrottled(key)) {
    return res.status(429).json({ error: "rate-limited", message: "Too many attempts. Please try again later." });
  }
  const deny = async () => {
    await recordFailure(key);
    return res.status(403).json({ error: "invalid-code", message: "That code didn't work." });
  };

  const shareToken = String(body.paper || "").trim();
  const shareKey = String(body.key || "").trim();
  if (shareToken && shareKey) {
    const doc = await findByIdOrSlug(audience, shareToken);
    if (!doc || !safeEqual(doc.data()?.shareKey, shareKey)) return deny();
    return res.json({ ok: true, scope: "single", papers: [toPublicPaper(doc.id, doc.data())] });
  }

  const code = normalizeInviteCode(body.code);
  if (!code) return deny();
  const ref = admin.firestore().collection(WRITING_INVITES_COLLECTION).doc(code);
  const invite = await ref.get();
  const data = invite.exists ? invite.data() || {} : null;
  const expired = data?.expiresAt && Date.parse(data.expiresAt) < Date.now();
  if (!data || data.active === false || expired || !(data.collections || []).includes(audience)) return deny();

  if (body.unlock === true) {
    await ref.set({
      uses: admin.firestore.FieldValue.increment(1),
      lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  const snap = await admin.firestore().collection(PROTECTED_WRITING_COLLECTION).where("collection", "==", audience).get();
  return res.json({ ok: true, scope: "all", papers: snap.docs.map((doc) => toPublicPaper(doc.id, doc.data())) });
}
