// Email-friendly image hosting. Published photos are original full-resolution
// files (often 5000px+ / several MB), which email clients' image proxies are slow
// to load or refuse outright. This downsizes an image once, caches the result in
// Firebase Storage (keyed by source URL + width) and returns the small copy's URL.
// Falls back to the original URL on any failure so a send is never blocked.

import { createHash, randomUUID } from "node:crypto";
import admin from "firebase-admin";
import sharp from "sharp";

function bucketHandle() {
  return admin.storage().bucket(admin.app().options.storageBucket || "stories-from-abroad.firebasestorage.app");
}

export async function ensureEmailImageUrl(sourceUrl, width, logger) {
  const url = String(sourceUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return url;
  try {
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 20);
    const filePath = `email-assets/img/${hash}-${width}.jpg`;
    const bucket = bucketHandle();
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    let token;
    if (exists) {
      const [metadata] = await file.getMetadata();
      token = String(metadata?.metadata?.firebaseStorageDownloadTokens || "").split(",")[0];
    }
    if (!exists || !token) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`source image ${response.status}`);
      const input = Buffer.from(await response.arrayBuffer());
      const output = await sharp(input)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      token = randomUUID();
      await file.save(output, {
        resumable: false,
        contentType: "image/jpeg",
        metadata: {
          cacheControl: "public, max-age=31536000",
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
    }
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  } catch (error) {
    logger?.warn?.("Email image resize failed; using original", { url: url.slice(0, 120), error: error.message });
    return url;
  }
}

export async function ensureEmailImageUrls(items, getUrl, setUrl, width, logger) {
  return Promise.all(items.map(async (item) => {
    const original = getUrl(item);
    return original ? setUrl(item, await ensureEmailImageUrl(original, width, logger)) : item;
  }));
}
