// Build-time loader for published papers (Firestore `papers` collection is public-read).
// Used to prerender one crawlable page per paper.

const RESERVED_SLUGS = new Set(["drafts", "unpublished"]);

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decodeValue(value)]));
}

export async function loadCollection(collectionId) {
  const projectId = import.meta.env.PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = import.meta.env.PUBLIC_FIREBASE_API_KEY;
  if (!projectId || !apiKey) {
    console.warn("[publicPapers] Firebase env vars missing; no per-item pages will be generated.");
    return [];
  }

  const papers = [];
  let pageToken = "";
  do {
    const url =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${collectionId}` +
      `?pageSize=200&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const response = await fetch(url);
    if (response.status === 404) break;
    // Fail the build rather than silently deploying a site with every paper page missing.
    if (!response.ok) throw new Error(`[publicPapers] Firestore request failed: ${response.status}`);
    const payload = await response.json();
    for (const doc of payload.documents || []) {
      const id = String(doc.name || "").split("/").pop() || "";
      papers.push({ id, ...decodeFields(doc.fields || {}) });
    }
    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return papers;
}

export async function loadPublishedPapers() {
  const papers = await loadCollection("papers");
  return papers
    .map((paper) => ({ ...paper, token: String(paper.slug || paper.id || "").trim() }))
    .filter((paper) => paper.token && !RESERVED_SLUGS.has(paper.token) && /^[A-Za-z0-9._~-]+$/.test(paper.token) && paper.title);
}

export async function loadPublishedShoots() {
  const shoots = await loadCollection("photo_shoots");
  return shoots
    .map((shoot) => ({ ...shoot, token: String(shoot.slug || shoot.id || "").trim() }))
    .filter((shoot) => shoot.token && /^[A-Za-z0-9._~-]+$/.test(shoot.token) && shoot.title);
}

export async function loadPublishedFaces() {
  const faces = await loadCollection("faces");
  return faces
    .map((face) => ({ ...face, token: String(face.slug || face.id || "").trim() }))
    .filter((face) => face.token && /^[A-Za-z0-9._~-]+$/.test(face.token) && face.name);
}

export function parseDate(item) {
  const parsed = Date.parse(item.date || item.shootDate || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}
