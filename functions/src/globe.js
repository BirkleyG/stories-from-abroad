// Renders the Dispatches globe (red coastline outlines + graticule + location
// pin, orthographic, centered on the dispatch's longitude) as a PNG so it can
// be embedded in the Travel email. Mirrors the three.js <Globe> in
// src/components/ScrapSheet.jsx. Email clients can't run WebGL and strip inline
// SVG, so the image is rendered server-side and hosted in Firebase Storage.

import { randomUUID } from "node:crypto";
import admin from "firebase-admin";
import { Resvg } from "@resvg/resvg-js";

const LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";
const SIZE = 220; // px; displayed at ~96-110px in the email for retina sharpness
const R = 100;
const C = SIZE / 2;
const RED = "#CC1111";
const DEG = Math.PI / 180;

let landPromise = null;

function decodeLandRings(topo) {
  const { scale, translate } = topo.transform;
  const decoded = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map((pt) => {
      x += pt[0];
      y += pt[1];
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const getArc = (i) => (i < 0 ? decoded[~i].slice().reverse() : decoded[i]);
  const ringPoints = (indices) => {
    const pts = [];
    indices.forEach((idx, j) => {
      getArc(idx).forEach((pt, k) => {
        if (j === 0 || k > 0) pts.push(pt);
      });
    });
    return pts;
  };
  const rings = [];
  const walk = (geom) => {
    if (!geom) return;
    if (geom.type === "Polygon") geom.arcs.forEach((ring) => rings.push(ringPoints(ring)));
    else if (geom.type === "MultiPolygon") geom.arcs.forEach((poly) => poly.forEach((ring) => rings.push(ringPoints(ring))));
    else if (geom.type === "GeometryCollection") geom.geometries.forEach(walk);
  };
  walk(topo.objects.land);
  return rings;
}

function loadLandRings() {
  if (!landPromise) {
    landPromise = fetch(LAND_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`land data ${response.status}`);
        return response.json();
      })
      .then(decodeLandRings)
      .catch((error) => {
        landPromise = null; // retry next time
        throw error;
      });
  }
  return landPromise;
}

// Orthographic projection facing (lng0, 0). Returns {x, y, visible}.
function project(lng, lat, lng0) {
  const lam = (lng - lng0) * DEG;
  const phi = lat * DEG;
  const z = Math.cos(phi) * Math.cos(lam);
  return {
    x: C + R * Math.cos(phi) * Math.sin(lam),
    y: C - R * Math.sin(phi),
    visible: z > 0,
  };
}

// Turns a lng/lat polyline into SVG path data, breaking at the far side.
function pathFor(points, lng0) {
  let d = "";
  let pen = false;
  for (const [lng, lat] of points) {
    const p = project(lng, lat, lng0);
    if (!p.visible) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

function buildGlobeSvg(lng, lat, landRings) {
  const lng0 = lng;
  let grid = "";
  let equator = "";
  for (const latitude of [-60, -30, 0, 30, 60]) {
    const pts = [];
    for (let l = lng0 - 90; l <= lng0 + 90; l += 3) pts.push([l, latitude]);
    const d = pathFor(pts, lng0);
    if (latitude === 0) equator = d;
    else grid += d;
  }
  for (let meridian = 0; meridian < 360; meridian += 30) {
    const pts = [];
    for (let l = -90; l <= 90; l += 3) pts.push([meridian, l]);
    grid += pathFor(pts, lng0);
  }
  let land = "";
  for (const ring of landRings || []) {
    if (ring.length > 1) land += pathFor(ring, lng0);
  }
  const pin = project(lng, lat, lng0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
<circle cx="${C}" cy="${C}" r="${R}" fill="#1a1a1a" fill-opacity="0.55"/>
<path d="${grid}" fill="none" stroke="${RED}" stroke-opacity="0.18" stroke-width="0.8"/>
<path d="${equator}" fill="none" stroke="${RED}" stroke-opacity="0.32" stroke-width="0.9"/>
<path d="${land}" fill="none" stroke="${RED}" stroke-opacity="0.8" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${RED}" stroke-opacity="0.85" stroke-width="1.6"/>
<circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="9" fill="none" stroke="${RED}" stroke-opacity="0.5" stroke-width="1.2"/>
<circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="4.5" fill="${RED}"/>
</svg>`;
}

// Pure render, no network for the pin/grid; land outlines are best-effort.
export async function renderGlobePng(lng, lat) {
  let landRings = [];
  try {
    landRings = await loadLandRings();
  } catch {
    landRings = []; // still renders grid + pin
  }
  const svg = buildGlobeSvg(lng, lat, landRings);
  return new Resvg(svg, { fitTo: { mode: "width", value: SIZE } }).render().asPng();
}

// Renders (or reuses) the globe for a coordinate and returns a public URL,
// or "" if anything goes wrong (the email then falls back to a globe emoji).
export async function ensureGlobeImageUrl(longitude, latitude, logger) {
  const lng = Number(longitude);
  const lat = Number(latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return "";
  try {
    const key = `${lng.toFixed(2)}_${lat.toFixed(2)}`.replace(/-/g, "m").replace(/\./g, "p");
    const filePath = `email-assets/globes/globe-${key}.png`;
    const bucket = admin.storage().bucket(admin.app().options.storageBucket || "stories-from-abroad.firebasestorage.app");
    const file = bucket.file(filePath);
    const [exists] = await file.exists();
    let token;
    if (exists) {
      const [metadata] = await file.getMetadata();
      token = String(metadata?.metadata?.firebaseStorageDownloadTokens || "").split(",")[0];
    }
    if (!exists || !token) {
      const png = await renderGlobePng(lng, lat);
      token = randomUUID();
      await file.save(png, {
        resumable: false,
        contentType: "image/png",
        metadata: {
          cacheControl: "public, max-age=31536000",
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });
    }
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  } catch (error) {
    logger?.warn?.("Globe image generation failed; using emoji fallback", { error: error.message });
    return "";
  }
}
