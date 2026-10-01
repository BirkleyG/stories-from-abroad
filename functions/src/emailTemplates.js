// HTML email builders for subscriber broadcasts. One builder per content
// "kind" plus a "general" announcement type. Each builder returns
// { subject, html, text } ready to hand to the Resend API.
//
// These are intentionally table/inline-style based (not the site's real
// CSS) because email clients (Outlook in particular) do not reliably
// support external stylesheets, flexbox, or grid.

function cleanString(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return cleanString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2p(text, style = "margin:0 0 16px;") {
  return cleanString(text)
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p style="${style}">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function plainText(text) {
  return cleanString(text).replace(/\s+\n/g, "\n");
}

function ensureTrailingSlash(url) {
  const raw = cleanString(url) || "https://storiesfromabroad.com/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

export function buildContentUrl(baseUrl, kind, slug) {
  const base = ensureTrailingSlash(baseUrl);
  const safeSlug = encodeURIComponent(cleanString(slug));
  switch (kind) {
    case "papers":
      return `${base}selected-papers/?paper=${safeSlug}`;
    case "travel":
      return `${base}travel-stories/?post=${safeSlug}`;
    case "photography":
      return `${base}photography/?shoot=${safeSlug}`;
    case "faces":
      return `${base}faces-of-the-world/#/profile/${safeSlug}`;
    default:
      return base;
  }
}

function renderPreheader(text) {
  const filler = "&nbsp;&zwnj;".repeat(12);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(text)}${filler}</div>`;
}

function renderFooter({ baseUrl, bg, wordmark, link, muted, rule }) {
  const base = ensureTrailingSlash(baseUrl);
  return `
<tr>
  <td style="background:${bg};padding:44px 32px 34px;text-align:center;">
    <a href="${base}" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:11px;letter-spacing:.36em;text-transform:uppercase;color:${wordmark};text-decoration:none;display:inline-block;margin-bottom:18px;">Stories From Abroad</a>
    <p style="margin:0 0 18px;font-family:Georgia,serif;font-size:11px;letter-spacing:.05em;">
      <a href="${base}" style="color:${link};text-decoration:none;margin:0 9px;">Home</a>&nbsp;·&nbsp;<a href="${base}subscriber-settings/" style="color:${link};text-decoration:none;margin:0 9px;">Manage Preferences</a>&nbsp;·&nbsp;<a href="${base}unsubscribe/" style="color:${link};text-decoration:none;margin:0 9px;">Unsubscribe</a>
    </p>
    <div style="width:220px;height:1px;background:${rule};margin:0 auto 16px;"></div>
    <p style="margin:0;font-family:Georgia,serif;font-size:10px;letter-spacing:.08em;color:${muted};">&copy; ${new Date().getFullYear()} Stories From Abroad. All rights reserved.</p>
  </td>
</tr>`;
}

function renderShell({ title, fontHref, styleBlock, bodyRows, bg }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fontHref}" rel="stylesheet" />
<style>
  body,table,td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  ${styleBlock}
</style>
</head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};">
  <tr>
    <td align="center" style="padding:36px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">
        ${bodyRows}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

const GENERAL_FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Lora:ital,wght@0,400;0,500;1,400&display=swap";
const WRITING_FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap";
const PHOTO_FONTS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500&display=swap";
const FACES_FONTS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@0,400;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap";
const DISPATCH_FONTS = "https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Lora:ital,wght@0,400;1,400&display=swap";

// ---------------------------------------------------------------------------
// General announcement
// ---------------------------------------------------------------------------
export function buildGeneralEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl,
    heroUrl, heroAlt, ctaLabel, ctaUrl,
  } = ctx;
  const greeting = subscriberName ? `Dear ${escapeHtml(subscriberName)},` : "Dear reader,";
  const preheaderText = plainText(note).slice(0, 140) || subject;
  const linkLabel = cleanString(ctaLabel) || "Visit the Site";
  const linkUrl = cleanString(ctaUrl) || ensureTrailingSlash(baseUrl);

  const heroBlock = cleanString(heroUrl) ? `
  <tr><td style="padding:0 0 32px;">
    <img src="${escapeHtml(heroUrl)}" alt="${escapeHtml(heroAlt || "")}" width="600" style="width:100%;max-width:600px;height:auto;display:block;border:1px solid rgba(26,26,24,0.12);" />
  </td></tr>` : "";

  const bodyRows = `
${renderPreheader(preheaderText)}
<tr><td style="background:#142A1F;padding:34px 32px 26px;text-align:center;">
  <span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:10px;letter-spacing:.42em;text-transform:uppercase;color:rgba(243,237,226,0.62);">Stories From Abroad</span>
</td></tr>
<tr><td style="background:#F3EDE2;padding:48px 40px 8px;text-align:center;">
  <h1 style="margin:0 0 18px;font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:38px;line-height:1.15;color:#1C1815;">${escapeHtml(subject)}</h1>
  <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin:0 auto 28px;">
    <span style="display:inline-block;width:48px;height:1px;background:#7A716A;opacity:.4;vertical-align:middle;"></span>
    <span style="display:inline-block;font-size:13px;color:#1C1815;vertical-align:middle;">&#10022;</span>
    <span style="display:inline-block;width:48px;height:1px;background:#7A716A;opacity:.4;vertical-align:middle;"></span>
  </div>
</td></tr>
${heroBlock}
<tr><td style="background:#F3EDE2;padding:0 40px 8px;">
  <p style="margin:0 0 20px;font-family:Lora,Georgia,serif;font-style:italic;font-size:15px;color:#4A4340;">${greeting}</p>
  <div style="font-family:Lora,Georgia,serif;font-size:16px;line-height:1.8;color:#1C1815;">
    ${nl2p(note) || "<p>New from Stories From Abroad &mdash; read on for the details.</p>"}
  </div>
</td></tr>
<tr><td style="background:#F3EDE2;padding:20px 40px 52px;text-align:center;">
  <a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#1C4A2E;color:#F3EDE2;font-family:'Cormorant Garamond',Georgia,serif;font-size:11px;letter-spacing:.34em;text-transform:uppercase;padding:16px 38px;border:1px solid #1C4A2E;">${escapeHtml(linkLabel)} &rarr;</a>
</td></tr>
${renderFooter({ baseUrl, bg: "#162820", wordmark: "rgba(242,240,235,0.75)", link: "rgba(242,240,235,0.5)", muted: "rgba(242,240,235,0.32)", rule: "rgba(242,240,235,0.15)" })}
`;

  const html = renderShell({
    title: subject,
    preheader: preheaderText,
    fontHref: GENERAL_FONTS,
    styleBlock: "",
    bodyRows,
    bg: "#F3EDE2",
  });

  const text = [
    subject, "",
    greeting.replace(/<[^>]+>/g, ""), "",
    plainText(note), "",
    `${linkLabel}: ${linkUrl}`,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Writing / Papers & Op-Eds
// ---------------------------------------------------------------------------
export function buildWritingEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl, slug,
    title, subtitle, category, readTime, date, summary,
  } = ctx;
  const link = buildContentUrl(baseUrl, "papers", slug);
  const preheaderText = plainText(summary).slice(0, 140) || subject;
  const greeting = subscriberName ? `Dear ${escapeHtml(subscriberName)},` : "Dear reader,";
  const metaParts = [cleanString(category), cleanString(readTime), cleanString(date)].filter(Boolean);

  const bodyRows = `
${renderPreheader(preheaderText)}
<tr><td style="background:#FAFAF7;padding:38px 40px 0;text-align:center;">
  <span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:10px;letter-spacing:.4em;text-transform:uppercase;color:#C4922A;">New Paper Published</span>
</td></tr>
<tr><td style="background:#FAFAF7;padding:20px 44px 0;text-align:center;">
  <h1 style="margin:0 0 10px;font-family:'EB Garamond',Georgia,serif;font-weight:500;font-size:36px;line-height:1.18;color:#111110;">${escapeHtml(title)}</h1>
  ${subtitle ? `<p style="margin:0 0 18px;font-family:'EB Garamond',Georgia,serif;font-style:italic;font-size:16px;color:#4A4340;">${escapeHtml(subtitle)}</p>` : ""}
  ${metaParts.length ? `<p style="margin:0 0 30px;font-family:'Cormorant Garamond',Georgia,serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#7A7570;">${metaParts.map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}</p>` : ""}
</td></tr>
${summary ? `
<tr><td style="background:#FAFAF7;padding:0 44px 30px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="border-left:2px solid #C4922A;padding:2px 0 2px 22px;font-family:'EB Garamond',Georgia,serif;font-style:italic;font-size:17px;line-height:1.75;color:#2E2C28;">${escapeHtml(summary)}</td>
  </tr></table>
</td></tr>` : ""}
${note ? `
<tr><td style="background:#F2F0EB;padding:26px 44px;">
  <p style="margin:0 0 8px;font-family:'Cormorant Garamond',Georgia,serif;font-size:10px;letter-spacing:.28em;text-transform:uppercase;color:#7A7570;">A Note From The Author</p>
  <div style="font-family:'EB Garamond',Georgia,serif;font-size:16px;line-height:1.75;color:#2E2C28;">${nl2p(note)}</div>
</td></tr>` : ""}
<tr><td style="background:#FAFAF7;padding:36px 44px 54px;text-align:center;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:transparent;color:#111110;font-family:'Cormorant Garamond',Georgia,serif;font-size:11px;letter-spacing:.32em;text-transform:uppercase;padding:15px 38px;border:1px solid #111110;">Read the Paper &rarr;</a>
</td></tr>
${renderFooter({ baseUrl, bg: "#111110", wordmark: "rgba(250,250,247,0.75)", link: "rgba(250,250,247,0.5)", muted: "rgba(250,250,247,0.32)", rule: "rgba(250,250,247,0.15)" })}
`;

  const html = renderShell({
    title,
    preheader: preheaderText,
    fontHref: WRITING_FONTS,
    styleBlock: "",
    bodyRows,
    bg: "#FAFAF7",
  });

  const text = [
    `New Paper Published: ${title}`, subtitle ? subtitle : "", "",
    greeting.replace(/<[^>]+>/g, ""), "",
    plainText(summary), "",
    note ? `A note from the author:\n${plainText(note)}\n` : "",
    `Read the paper: ${link}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Photography
// ---------------------------------------------------------------------------
export function buildPhotographyEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl, slug,
    title, description, locationLabel, tags, frameCount, coverUrl, coverAlt, accentColor,
  } = ctx;
  const link = buildContentUrl(baseUrl, "photography", slug);
  const accent = /^#[0-9a-f]{6}$/i.test(cleanString(accentColor)) ? accentColor : "#FF2D78";
  const preheaderText = plainText(description).slice(0, 140) || subject;
  const greeting = subscriberName ? `${escapeHtml(subscriberName)},` : "Hello,";
  const metaParts = [cleanString(locationLabel), frameCount ? `${frameCount} frames` : ""].filter(Boolean);
  const tagRow = (Array.isArray(tags) ? tags : []).filter(Boolean).slice(0, 3)
    .map((tag) => `<span style="display:inline-block;border:1px solid rgba(240,239,235,0.28);color:rgba(240,239,235,0.7);font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.08em;padding:4px 11px;margin:0 4px;">${escapeHtml(tag)}</span>`)
    .join("");

  const bodyRows = `
${renderPreheader(preheaderText)}
<tr><td style="background:#080808;padding:30px 32px 22px;text-align:center;">
  <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.36em;text-transform:uppercase;color:${accent};">New Shoot</span>
</td></tr>
${coverUrl ? `
<tr><td style="background:#080808;padding:0;">
  <img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(coverAlt || title || "")}" width="600" style="width:100%;max-width:600px;height:auto;display:block;" />
</td></tr>` : ""}
<tr><td style="background:#080808;padding:34px 40px 6px;text-align:center;">
  <h1 style="margin:0 0 10px;font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:44px;line-height:1;letter-spacing:.01em;color:#F0EFEB;">${escapeHtml(title)}</h1>
  ${metaParts.length ? `<p style="margin:0 0 18px;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${accent};">${metaParts.map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}</p>` : ""}
  ${tagRow ? `<p style="margin:0 0 26px;">${tagRow}</p>` : ""}
</td></tr>
${description || note ? `
<tr><td style="background:#080808;padding:0 40px 10px;">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.85;color:rgba(240,239,235,0.72);">
    ${nl2p(description, "margin:0 0 14px;")}
    ${note ? nl2p(note, "margin:0 0 14px;") : ""}
  </div>
</td></tr>` : ""}
<tr><td style="background:#080808;padding:28px 40px 56px;text-align:center;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:${accent};color:#080808;font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:15px 34px;">View the Full Shoot &rarr;</a>
</td></tr>
${renderFooter({ baseUrl, bg: "#000000", wordmark: "rgba(240,239,235,0.8)", link: "rgba(240,239,235,0.5)", muted: "rgba(240,239,235,0.32)", rule: "rgba(240,239,235,0.14)" })}
`;

  const html = renderShell({
    title,
    preheader: preheaderText,
    fontHref: PHOTO_FONTS,
    styleBlock: "",
    bodyRows,
    bg: "#080808",
  });

  const text = [
    `New Shoot: ${title}`, metaParts.join(" · "), "",
    greeting.replace(/<[^>]+>/g, ""), "",
    plainText(description), note ? plainText(note) : "", "",
    `View the shoot: ${link}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Faces of the World
// ---------------------------------------------------------------------------
export function buildFacesEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl, slug,
    name, city, country, occupation, excerpt, portraitUrl, portraitAlt,
  } = ctx;
  const link = buildContentUrl(baseUrl, "faces", slug);
  const preheaderText = plainText(excerpt).slice(0, 140) || subject;
  const greeting = subscriberName ? `${escapeHtml(subscriberName)},` : "Hello,";
  const location = [cleanString(city), cleanString(country)].filter(Boolean).join(", ");

  const bodyRows = `
${renderPreheader(preheaderText)}
<tr><td style="background:#0A0A0A;padding:32px 32px 24px;text-align:center;">
  <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.4em;text-transform:uppercase;color:#C9A84C;">Portrait Series</span>
</td></tr>
${portraitUrl ? `
<tr><td style="background:#0A0A0A;padding:0 0 30px;text-align:center;">
  <img src="${escapeHtml(portraitUrl)}" alt="${escapeHtml(portraitAlt || name || "")}" width="220" height="220" style="width:220px;height:220px;border-radius:50%;object-fit:cover;display:inline-block;border:1px solid rgba(201,168,76,0.35);" />
</td></tr>` : ""}
<tr><td style="background:#0A0A0A;padding:0 44px 4px;text-align:center;">
  ${location ? `<p style="margin:0 0 10px;font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#C9A84C;">${escapeHtml(location)}</p>` : ""}
  <h1 style="margin:0 0 6px;font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:38px;color:#F0EFEB;">${escapeHtml(name)}</h1>
  ${occupation ? `<p style="margin:0 0 26px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:16px;color:rgba(240,239,235,0.62);">${escapeHtml(occupation)}</p>` : ""}
</td></tr>
${excerpt ? `
<tr><td style="background:#0A0A0A;padding:0 44px 26px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="border-left:1px solid rgba(201,168,76,0.35);padding:2px 0 2px 20px;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:17px;line-height:1.7;color:rgba(240,239,235,0.85);">${escapeHtml(excerpt)}</td>
  </tr></table>
</td></tr>` : ""}
${note ? `
<tr><td style="background:#0A0A0A;padding:0 44px 26px;">
  <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:16px;line-height:1.75;color:rgba(240,239,235,0.85);">${nl2p(note)}</div>
</td></tr>` : ""}
<tr><td style="background:#0A0A0A;padding:24px 44px 56px;text-align:center;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:transparent;color:#C9A84C;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.2em;text-transform:uppercase;padding:14px 34px;border:1px solid #C9A84C;">Read Their Story &rarr;</a>
</td></tr>
${renderFooter({ baseUrl, bg: "#000000", wordmark: "rgba(201,168,76,0.75)", link: "rgba(240,239,235,0.5)", muted: "rgba(240,239,235,0.3)", rule: "rgba(201,168,76,0.18)" })}
`;

  const html = renderShell({
    title: name,
    preheader: preheaderText,
    fontHref: FACES_FONTS,
    styleBlock: "",
    bodyRows,
    bg: "#0A0A0A",
  });

  const text = [
    `Faces of the World: ${name}`, location, "",
    greeting.replace(/<[^>]+>/g, ""), "",
    plainText(excerpt), note ? plainText(note) : "", "",
    `Read their story: ${link}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Dispatch / Travel (Scrap Sheet)
// ---------------------------------------------------------------------------
export function buildDispatchEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl, slug,
    title, location, date, preview, photoUrl, photoAlt,
  } = ctx;
  const link = buildContentUrl(baseUrl, "travel", slug);
  const preheaderText = plainText(preview).slice(0, 140) || subject;
  const greeting = subscriberName ? `Dear ${escapeHtml(subscriberName)},` : "Dear reader,";
  const stamp = [cleanString(location), cleanString(date)].filter(Boolean).join(" &nbsp;&middot;&nbsp; ");

  const photoBlock = cleanString(photoUrl) ? `
  <tr><td style="background:#F0E9DF;padding:0 40px 28px;text-align:center;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr><td style="background:#FAF7F2;padding:10px 10px 26px;border:1px solid #D8CFC4;transform:rotate(-1deg);">
        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(photoAlt || title || "")}" width="480" style="width:100%;max-width:480px;height:auto;display:block;" />
      </td></tr>
    </table>
  </td></tr>` : "";

  const bodyRows = `
${renderPreheader(preheaderText)}
<tr><td style="background:#F0E9DF;padding:36px 40px 6px;text-align:center;">
  <span style="display:inline-block;border:1px dashed #CC1111;color:#CC1111;font-family:'Jost',Arial,sans-serif;font-weight:500;font-size:10px;letter-spacing:.24em;text-transform:uppercase;padding:7px 16px;">Dispatch${stamp ? ` &nbsp;&middot;&nbsp; ${stamp}` : ""}</span>
</td></tr>
<tr><td style="background:#F0E9DF;padding:26px 40px 26px;text-align:center;">
  <h1 style="margin:0;font-family:'Jost',Arial,sans-serif;font-weight:600;font-size:32px;line-height:1.25;color:#1B1410;">${escapeHtml(title)}</h1>
</td></tr>
${photoBlock}
<tr><td style="background:#F0E9DF;padding:0 44px 6px;">
  <p style="margin:0 0 20px;font-family:Lora,Georgia,serif;font-style:italic;font-size:15px;color:#4D3F34;">${greeting}</p>
  <div style="font-family:Lora,Georgia,serif;font-size:16px;line-height:1.8;color:#1B1410;">
    ${nl2p(preview)}
  </div>
</td></tr>
${note ? `
<tr><td style="background:#EDE5D8;padding:24px 44px;margin-top:20px;">
  <div style="font-family:Lora,Georgia,serif;font-size:15px;font-style:italic;line-height:1.75;color:#4D3F34;">${nl2p(note)}</div>
</td></tr>` : ""}
<tr><td style="background:#F0E9DF;padding:32px 44px 54px;text-align:center;">
  <a href="${escapeHtml(link)}" style="display:inline-block;background:#CC1111;color:#FAF7F2;font-family:'Jost',Arial,sans-serif;font-weight:500;font-size:12px;letter-spacing:.14em;text-transform:uppercase;padding:15px 34px;">Read the Full Dispatch &rarr;</a>
</td></tr>
${renderFooter({ baseUrl, bg: "#1B1410", wordmark: "rgba(240,233,223,0.78)", link: "rgba(240,233,223,0.5)", muted: "rgba(240,233,223,0.32)", rule: "rgba(240,233,223,0.16)" })}
`;

  const html = renderShell({
    title,
    preheader: preheaderText,
    fontHref: DISPATCH_FONTS,
    styleBlock: "",
    bodyRows,
    bg: "#F0E9DF",
  });

  const text = [
    `Dispatch: ${title}`, stamp.replace(/&nbsp;|&middot;/g, " ").trim(), "",
    greeting.replace(/<[^>]+>/g, ""), "",
    plainText(preview), note ? plainText(note) : "", "",
    `Read the full dispatch: ${link}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

export function buildEmailForKind(kind, ctx) {
  switch (kind) {
    case "papers":
      return buildWritingEmail(ctx);
    case "photography":
      return buildPhotographyEmail(ctx);
    case "faces":
      return buildFacesEmail(ctx);
    case "travel":
      return buildDispatchEmail(ctx);
    default:
      return buildGeneralEmail(ctx);
  }
}

export { escapeHtml };
