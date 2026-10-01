// HTML email builders for subscriber broadcasts. One builder per content
// "kind" plus a "general" announcement type. Each builder returns
// { subject, html, text } ready to hand to the Resend API.
//
// The designs mirror the hand-built templates in "SFA Email Templates"
// (Writing, Faces, Dispatch/General, Photography, Travel). Layout uses
// tables + inline styles so it survives Gmail/Outlook; a small <style> block
// adds mobile tightening via media queries and loads the web fonts for clients
// that support them (Apple Mail, iOS Mail). Everything falls back to Georgia
// or a system font elsewhere.

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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Accepts "2026-03-13", "February 14, 2026", ISO timestamps; returns "March 13, 2026".
export function formatLongDate(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const month = MONTHS[Number(iso[2]) - 1];
    return month ? `${month} ${Number(iso[3])}, ${iso[1]}` : raw;
  }
  return raw;
}

function monthYear(value) {
  const long = formatLongDate(value);
  const match = long.match(/^([A-Za-z]+) \d{1,2}, (\d{4})$/);
  return match ? `${match[1]} ${match[2]}` : long;
}

// Lightens a dark accent so it stays legible as text on the black photo design.
function readableOnDark(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(cleanString(hex));
  if (!m) return "#c96b28";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= 0.38) return cleanString(hex);
  const mix = Math.min(0.62, (0.5 - lum) * 1.3);
  const lift = (c) => Math.round(c + (255 - c) * mix).toString(16).padStart(2, "0");
  return `#${lift(r)}${lift(g)}${lift(b)}`;
}

function safeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(cleanString(value)) ? cleanString(value) : fallback;
}

function renderPreheader(text) {
  const filler = "&nbsp;&zwnj;".repeat(12);
  return `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(text)}${filler}</div>`;
}

const MOBILE_CSS = `
  body,table,td { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media only screen and (max-width:620px) {
    .px { padding-left:22px !important; padding-right:22px !important; }
    .t1 { font-size:30px !important; line-height:1.15 !important; }
    .t2 { font-size:26px !important; line-height:1.25 !important; }
    .t3 { font-size:24px !important; }
    .wide { letter-spacing:0.22em !important; }
    .stack { display:block !important; width:100% !important; padding-right:0 !important; }
  }`;

// Full-bleed bands: every top-level <td class="px"|"c"> keeps its background and
// borders on a full-width outer cell, while its content sits in a centered 600px
// column (with an Outlook-desktop fixed-width ghost table). Mobile padding still
// comes from the .px media query on the inner cell.
function wrapBand(openTag, inner, classes) {
  const styleMatch = openTag.match(/style="([^"]*)"/);
  const decls = (styleMatch ? styleMatch[1] : "").split(";").map((part) => part.trim()).filter(Boolean);
  const padding = decls.filter((decl) => /^padding/i.test(decl));
  const rest = decls.filter((decl) => !/^padding/i.test(decl));
  const otherAttrs = openTag.replace(/^<td/i, "").replace(/>$/, "").replace(/\s*class="[^"]*"/, "").replace(/\s*style="[^"]*"/, "");
  const innerCell = classes.includes("px") ? `<td class="px" style="${padding.join(";")}">` : "<td>";
  return `<td${otherAttrs}${rest.length ? ` style="${rest.join(";")}"` : ""}><!--[if mso]><table role="presentation" align="center" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:600px;margin:0 auto;"><tr>${innerCell}${inner}</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td>`;
}

function bleed(html) {
  const tagPattern = /<(\/?)(table|td)\b([^>]*)>/gi;
  let out = "";
  let last = 0;
  let tableDepth = 0;
  let tdDepth = 0;
  let openIndex = -1;
  let openTag = "";
  let innerStart = -1;
  let match;
  while ((match = tagPattern.exec(html))) {
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (name === "table") {
      tableDepth += closing ? -1 : 1;
      continue;
    }
    if (!closing) {
      if (tableDepth === 1 && tdDepth === 0) {
        openIndex = match.index;
        openTag = match[0];
        innerStart = tagPattern.lastIndex;
        tdDepth = 1;
      } else if (tdDepth > 0) {
        tdDepth += 1;
      }
    } else if (tdDepth > 0) {
      tdDepth -= 1;
      if (tdDepth === 0) {
        const classMatch = openTag.match(/class="([^"]*)"/);
        const classes = classMatch ? classMatch[1].split(/\s+/) : [];
        if (classes.includes("px") || classes.includes("c")) {
          out += html.slice(last, openIndex) + wrapBand(openTag, html.slice(innerStart, match.index), classes);
          last = match.index + match[0].length;
        }
      }
    }
  }
  return out + html.slice(last);
}

function renderShell({ title, preheader, fontsHref, bodyRows, wrapperBg }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="${fontsHref}" rel="stylesheet" />
<style>${MOBILE_CSS}</style>
</head>
<body style="margin:0;padding:0;">
${renderPreheader(preheader)}
<div style="width:100%;background-color:${wrapperBg};text-align:left;">
${bleed(bodyRows)}
</div>
</body>
</html>`;
}

// "label ———— label" section rule built from a table (no flexbox).
function ruleRow({ left, right, labelStyle, lineColor, padY, padX, bg, borders }) {
  const px = `${padX}px`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${bg};${borders}"><tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:600px;margin:0 auto;"><tr>
  <td style="${labelStyle}padding:${padY}px 16px ${padY}px ${px};white-space:nowrap;">${left}</td>
  <td width="100%" style="padding:${padY}px ${right ? "16px" : px} ${padY}px 0;"><div style="height:1px;background-color:${lineColor};line-height:1px;font-size:1px;">&nbsp;</div></td>
  ${right ? `<td style="${labelStyle}padding:${padY}px ${px} ${padY}px 0;white-space:nowrap;">${right}</td>` : ""}
</tr></table></td></tr></table>`;
}

function lead(color, width = 22) {
  return `<span style="display:inline-block;width:${width}px;height:1px;background-color:${color};vertical-align:middle;margin-right:12px;"></span>`;
}

function footerLinks(baseUrl, color) {
  const base = ensureTrailingSlash(baseUrl);
  return `<a href="${base}subscriber-settings/" style="color:${color};text-decoration:underline;">Manage preferences</a> &nbsp;&middot;&nbsp; <a href="${base}unsubscribe/" style="color:${color};text-decoration:underline;">Unsubscribe</a>`;
}

function textFooter(baseUrl) {
  const base = ensureTrailingSlash(baseUrl);
  return ["", `Manage preferences: ${base}subscriber-settings/`, `Unsubscribe: ${base}unsubscribe/`];
}

const FONTS = {
  writing: "https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;1,300&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Lora:ital,wght@0,400;1,400&display=swap",
  faces: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;1,400&family=Josefin+Sans:wght@300;400&display=swap",
  general: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Lora:ital,wght@0,400;1,400&display=swap",
  photo: "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400&display=swap",
};

const CG = "'Cormorant Garamond',Georgia,serif";
const CO = "'Cormorant',Georgia,serif";
const LO = "'Lora',Georgia,serif";

function firstSentence(text) {
  const clean = cleanString(text).replace(/\s+/g, " ");
  const match = clean.match(/^.*?[.!?](?=\s|$)/);
  return match ? match[0] : clean.slice(0, 160);
}

// ---------------------------------------------------------------------------
// General announcement (green "Dispatch" design)
//   subject -> header title, subtitle -> bold second header line,
//   note -> "A note from BTG", body + pullQuote -> "This Dispatch" section.
// ---------------------------------------------------------------------------
export function buildGeneralEmail(ctx) {
  const {
    subject, note, subscriberName, baseUrl,
    subtitle, body, pullQuote,
    heroUrl, heroAlt, ctaLabel, ctaUrl, issueNumber, dateLabel,
  } = ctx;
  const greeting = subscriberName ? `Dear ${escapeHtml(subscriberName)} &mdash;` : "Dear reader &mdash;";
  const preheaderText = plainText(note || body).slice(0, 140) || subject;
  const linkLabel = cleanString(ctaLabel) || "Visit Stories From Abroad";
  const linkUrl = cleanString(ctaUrl) || ensureTrailingSlash(baseUrl);
  const stamp = cleanString(dateLabel) || monthYear(new Date().toISOString());
  const kicker = cleanString(issueNumber) ? `Dispatch No. ${escapeHtml(issueNumber)}` : "Dispatch";

  const heroBlock = cleanString(heroUrl) ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="c"><img src="${escapeHtml(heroUrl)}" alt="${escapeHtml(heroAlt || "")}" width="600" style="display:block;width:100%;max-width:600px;height:auto;" /></td></tr></table>` : "";

  const hasBody = Boolean(cleanString(body) || cleanString(pullQuote));
  const bodyHtml = hasBody ? `
<tr><td>${ruleRow({
    left: "&#10022; &nbsp; This Dispatch", right: "", labelStyle: `font-family:${CG};font-size:9.5px;letter-spacing:0.44em;text-transform:uppercase;color:#7A7570;`,
    lineColor: "#E2DDD4", padY: 18, padX: 48, bg: "#F2F0EB", borders: "border-top:1px solid #E2DDD4;border-bottom:1px solid #E2DDD4;",
  })}</td></tr>
<tr><td class="px" style="padding:36px 48px 32px;">
  ${cleanString(body) ? nl2p(body, `margin:0 0 18px;font-family:${LO};font-size:15.5px;line-height:1.84;color:#2E2C28;`) : ""}
  ${cleanString(pullQuote) ? `<div style="margin:28px 0;padding:20px 24px;border-left:3px solid #C4922A;background-color:#F2F0EB;"><p style="margin:0;font-family:${CG};font-size:21px;font-style:italic;line-height:1.52;color:#111110;">${escapeHtml(pullQuote)}</p></div>` : ""}
</td></tr>` : "";

  const bodyRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="px" style="background-color:#1C4A2E;padding:36px 48px 32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr>
    <td style="font-family:${CG};font-size:11px;letter-spacing:0.34em;text-transform:uppercase;color:rgba(250,250,247,0.55);font-style:italic;">Stories From Abroad</td>
    <td align="right" style="font-family:${CG};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(250,250,247,0.4);">${escapeHtml(stamp)}</td>
  </tr></table>
  <div style="font-size:22px;color:#C4922A;margin-bottom:14px;">&#10022;</div>
  <h1 class="t1" style="margin:0;font-family:${CG};font-size:38px;font-weight:300;font-style:italic;line-height:1.1;color:#FAFAF7;letter-spacing:-0.01em;">${escapeHtml(subject)}${cleanString(subtitle) ? `<br><strong style="font-style:normal;font-weight:600;">${escapeHtml(subtitle)}</strong>` : ""}</h1>
  <div style="border-top:1px solid rgba(250,250,247,0.14);margin-top:24px;"></div>
  <div class="wide" style="font-family:${CG};font-size:9.5px;letter-spacing:0.46em;text-transform:uppercase;color:#C4922A;margin-top:18px;">${lead("#C4922A")}${kicker} &nbsp;&middot;&nbsp; Est. 2024</div>
</td></tr></table>
${heroBlock}
${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;"><tr><td class="px" style="padding:40px 48px 32px;border-bottom:1px solid #E2DDD4;">
  <div style="font-family:${CG};font-size:9.5px;letter-spacing:0.42em;text-transform:uppercase;color:#7A7570;margin-bottom:18px;">A note from BTG &mdash;</div>
  <p style="margin:0 0 18px;font-family:${LO};font-style:italic;font-size:18px;line-height:1.5;color:#2E2C28;">${greeting}</p>
  ${nl2p(note, `margin:0 0 16px;font-family:${LO};font-size:16px;line-height:1.82;color:#2E2C28;`)}
  <p style="margin:22px 0 0;font-family:${LO};font-style:italic;font-size:17px;color:#7A7570;">Until the next one,<br><strong style="font-style:normal;font-weight:500;color:#2E2C28;font-family:${CG};font-size:15px;letter-spacing:0.08em;">B.T.G.</strong></p>
</td></tr></table>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;">${bodyHtml}
<tr><td class="px" style="padding:${hasBody ? "0" : "36px"} 48px 44px;"><a href="${escapeHtml(linkUrl)}" style="display:inline-block;background-color:#1C4A2E;color:#FAFAF7;font-family:${CG};font-size:11px;letter-spacing:0.3em;text-transform:uppercase;padding:13px 30px;">${escapeHtml(linkLabel)} &rarr;</a></td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="px" style="background-color:#111110;padding:22px 48px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:${CG};font-style:italic;font-size:11px;letter-spacing:0.1em;color:rgba(250,250,247,0.4);">Stories From Abroad</td>
    <td align="right" style="font-family:${CG};font-size:10px;letter-spacing:0.12em;color:rgba(250,250,247,0.4);">${footerLinks(baseUrl, "rgba(250,250,247,0.5)")}</td>
  </tr></table>
</td></tr></table>`;

  const html = renderShell({ title: subject, preheader: preheaderText, fontsHref: FONTS.general, bodyRows, wrapperBg: "#FAFAF7" });
  const text = [
    subject, subtitle || "", "",
    greeting.replace(/&mdash;/g, "—"), "",
    plainText(note), "",
    plainText(body), pullQuote ? `"${plainText(pullQuote)}"` : "", "",
    `${linkLabel}: ${linkUrl}`,
    ...textFooter(baseUrl),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Writing / Papers & Op-Eds (cream "Selected Writing" design)
// ---------------------------------------------------------------------------
export function buildWritingEmail(ctx) {
  const {
    subject, note, baseUrl, slug,
    title, category, readTime, date, summary, keywords, pullQuote, archive, subscriberName,
  } = ctx;
  const link = buildContentUrl(baseUrl, "papers", slug);
  const preheaderText = plainText(summary).slice(0, 140) || subject;
  const quote = cleanString(pullQuote) || firstSentence(summary);
  const kw = (Array.isArray(keywords) ? keywords : []).filter(Boolean).slice(0, 3);
  const archiveItems = (Array.isArray(archive) ? archive : []).slice(0, 2);
  const label = cleanString(category);
  const greeting = subscriberName ? `Dear ${escapeHtml(subscriberName)},` : "";

  const kwRow = kw.length ? `
<tr><td class="px" style="padding:24px 48px;border-bottom:1px solid #E2DDD4;">
  <span style="display:inline-block;font-family:${CG};font-size:9.5px;letter-spacing:0.38em;text-transform:uppercase;color:#C4922A;margin:0 8px 6px 0;">Keywords</span>${kw.map((word) => `<span style="display:inline-block;font-family:${CG};font-size:10.5px;letter-spacing:0.1em;color:#7A7570;border:1px solid #E2DDD4;padding:3px 11px;margin:0 6px 6px 0;">${escapeHtml(word)}</span>`).join("")}
</td></tr>` : "";

  const archiveBlock = archiveItems.length ? `
<tr><td class="px" style="background-color:#F2F0EB;border-top:1px solid #E2DDD4;padding:28px 48px 36px;">
  <div style="font-family:${CG};font-size:9.5px;letter-spacing:0.46em;text-transform:uppercase;color:#7A7570;margin-bottom:12px;">From the Archive</div>
  ${archiveItems.map((item) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #E2DDD4;"><tr>
    <td style="padding:14px 0;"><a href="${escapeHtml(item.url)}" style="display:block;font-family:${CO};font-size:16px;color:#111110;">${escapeHtml(item.title)}</a><div style="font-family:${CG};font-size:11px;letter-spacing:0.06em;color:#7A7570;margin-top:3px;">${[item.category, formatLongDate(item.date)].filter(Boolean).map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}</div></td>
    <td width="20" align="right" valign="middle" style="color:#B9B2A6;font-size:16px;">&rarr;</td>
  </tr></table>`).join("")}
</td></tr>` : "";

  const bodyRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;">
<tr><td class="px" style="padding:18px 48px;border-bottom:1px solid #E2DDD4;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="font-family:${CG};font-style:italic;font-size:13px;letter-spacing:0.04em;color:#2E2C28;">Stories From Abroad</td>
  <td align="right" style="font-family:${CG};font-size:9.5px;letter-spacing:0.46em;text-transform:uppercase;color:#C4922A;">Papers &amp; Op-Eds</td>
</tr></table></td></tr>
<tr><td class="px" style="padding:52px 48px 40px;">
  <div class="wide" style="font-family:${CG};font-size:9.5px;letter-spacing:0.52em;text-transform:uppercase;color:#C4922A;margin-bottom:28px;">${lead("#C4922A", 28)}${label ? `${escapeHtml(label)} &nbsp;&middot;&nbsp; ` : ""}New Writing</div>
  ${quote ? `<span style="display:block;font-family:${CO};font-size:80px;font-weight:300;line-height:0.6;color:#E8D9B5;margin-bottom:8px;">&ldquo;</span>
  <p class="t1" style="margin:0 0 20px;font-family:${CO};font-size:32px;font-weight:300;font-style:italic;line-height:1.32;color:#111110;letter-spacing:-0.01em;">${escapeHtml(quote)}</p>
  <div style="width:52px;height:2px;background-color:#C4922A;margin:24px 0 20px;"></div>
  <div style="font-family:${CG};font-size:10px;letter-spacing:0.32em;text-transform:uppercase;color:#7A7570;">&mdash; From <span style="color:#C4922A;">${escapeHtml(title)}</span></div>` : `<h1 class="t1" style="margin:0;font-family:${CO};font-size:32px;font-weight:300;font-style:italic;line-height:1.32;color:#111110;">${escapeHtml(title)}</h1>`}
</td></tr>
<tr><td class="px" style="padding:0 48px 36px;border-bottom:1px solid #E2DDD4;">
  ${ruleRow({ left: "The Paper", right: cleanString(readTime) ? `${escapeHtml(readTime)} read` : "", labelStyle: `font-family:${CG};font-size:9.5px;letter-spacing:0.46em;text-transform:uppercase;color:#7A7570;`, lineColor: "#E2DDD4", padY: 16, padX: 0, bg: "transparent", borders: "" })}
  ${label ? `<div style="margin-bottom:14px;"><span style="display:inline-block;font-family:${CG};font-size:10px;letter-spacing:0.1em;color:#7A7570;border:1px solid #E2DDD4;padding:3px 11px;">${escapeHtml(label)}</span></div>` : ""}
  <h1 class="t2" style="margin:0 0 10px;font-family:${CO};font-size:30px;font-weight:400;line-height:1.15;color:#111110;letter-spacing:-0.01em;">${escapeHtml(title)}</h1>
  <div style="font-family:${CG};font-size:11.5px;letter-spacing:0.06em;color:#7A7570;margin-bottom:22px;">By Birkley Grunewald${date ? ` <span style="padding:0 9px;color:#B9B2A6;">&middot;</span> ${escapeHtml(formatLongDate(date))}` : ""} <span style="padding:0 9px;color:#B9B2A6;">&middot;</span> Paper</div>
  ${summary ? `<p style="margin:0;font-family:${LO};font-size:14.5px;font-style:italic;line-height:1.84;color:#2E2C28;">${escapeHtml(summary)}</p>` : ""}
</td></tr>
${note ? `<tr><td class="px" style="padding:26px 48px;border-bottom:1px solid #E2DDD4;"><div style="font-family:${CG};font-size:9.5px;letter-spacing:0.38em;text-transform:uppercase;color:#C4922A;margin-bottom:10px;">A Note From The Author</div>${greeting ? `<p style="margin:0 0 10px;font-family:${LO};font-style:italic;font-size:15px;color:#4A4340;">${greeting}</p>` : ""}${nl2p(note, `margin:0 0 12px;font-family:${LO};font-size:15px;line-height:1.8;color:#2E2C28;`)}</td></tr>` : ""}
${kwRow}
<tr><td class="px" style="padding:32px 48px 44px;"><a href="${escapeHtml(link)}" style="display:inline-block;background-color:#1C4A2E;color:#FAFAF7;font-family:${CG};font-size:11px;letter-spacing:0.3em;text-transform:uppercase;padding:13px 30px;">Read the Paper &nbsp;&rarr;</a>${readTime ? `<span style="display:inline-block;margin-left:16px;font-family:${CG};font-size:11px;letter-spacing:0.1em;color:#7A7570;">${escapeHtml(readTime)}</span>` : ""}</td></tr>
${archiveBlock}
<tr><td class="px" style="background-color:#111110;padding:22px 48px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="font-family:${CG};font-style:italic;font-size:11px;letter-spacing:0.1em;color:rgba(250,250,247,0.4);">Stories From Abroad</td>
  <td align="right" style="font-family:${CG};font-size:10px;letter-spacing:0.12em;color:rgba(250,250,247,0.4);">${footerLinks(baseUrl, "rgba(250,250,247,0.5)")}</td>
</tr></table></td></tr>
</table>`;

  const html = renderShell({ title, preheader: preheaderText, fontsHref: FONTS.writing, bodyRows, wrapperBg: "#FAFAF7" });
  const text = [
    `New Paper: ${title}`, [label, readTime, formatLongDate(date)].filter(Boolean).join(" · "), "",
    plainText(summary), "",
    note ? `A note from the author:\n${plainText(note)}\n` : "",
    `Read the paper: ${link}`,
    ...textFooter(baseUrl),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Photography (black "SEEN FELT KEPT" design, shoot accent color)
// ---------------------------------------------------------------------------
export function buildPhotographyEmail(ctx) {
  const {
    subject, note, baseUrl, slug,
    title, description, locationLabel, tags, frameCount, shootDate, coverUrl, coverAlt, accentColor, archive,
  } = ctx;
  const link = buildContentUrl(baseUrl, "photography", slug);
  const accent = safeHexColor(accentColor, "#c96b28");
  const accentText = readableOnDark(accent);
  const preheaderText = plainText(description).slice(0, 140) || subject;
  const place = cleanString(locationLabel);
  const [city, ...rest] = place.split(",").map((part) => part.trim());
  const country = rest.join(", ");
  const dateLabel = formatLongDate(shootDate);
  const tagList = (Array.isArray(tags) ? tags : []).filter(Boolean).slice(0, 3);
  const archiveItems = (Array.isArray(archive) ? archive : []).slice(0, 3);
  const MONO = "'DM Mono','Courier New',monospace";
  const SERIF = "'DM Serif Display',Georgia,serif";

  const archiveGrid = archiveItems.length ? `
<tr><td class="px" style="padding:0 40px 14px;border-top:1px solid rgba(255,255,255,0.06);"><div style="font-family:${MONO};font-size:10px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(255,255,255,0.3);padding-top:24px;">From the Archive</div></td></tr>
<tr><td class="px" style="padding:0 40px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${archiveItems.map((item, index) => `
  <td width="33%" valign="top" style="padding-right:${index === archiveItems.length - 1 ? 0 : 10}px;"><a href="${escapeHtml(item.url)}" style="display:block;">${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" width="170" style="display:block;width:100%;height:96px;object-fit:cover;margin-bottom:7px;background-color:#111111;" />` : `<div style="height:96px;background-color:#111111;margin-bottom:7px;"></div>`}<div style="font-family:${MONO};font-size:11px;color:rgba(255,255,255,0.55);letter-spacing:0.04em;line-height:1.4;">${escapeHtml(item.title)}</div>${item.location ? `<div style="font-family:${MONO};font-size:9px;color:rgba(255,255,255,0.3);letter-spacing:0.1em;text-transform:uppercase;margin-top:3px;">${escapeHtml(item.location)}</div>` : ""}</a></td>`).join("")}
</tr></table></td></tr>` : "";

  const bodyRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#080808;">
<tr><td class="px" style="border-top:3px solid ${accent};padding:28px 40px 20px;border-bottom:1px solid rgba(255,255,255,0.06);">
  <div class="wide" style="font-family:${MONO};font-size:10px;font-weight:300;letter-spacing:0.32em;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-bottom:14px;">SEEN &middot; FELT &middot; KEPT</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-family:${MONO};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.3);">SFA Photography</td>
    <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.25);">${escapeHtml(monthYear(shootDate) || monthYear(new Date().toISOString()))}</td>
  </tr></table>
</td></tr>
${coverUrl ? `<tr><td class="c"><a href="${escapeHtml(link)}" style="display:block;"><img src="${escapeHtml(coverUrl)}" alt="${escapeHtml(coverAlt || title || "")}" width="600" style="display:block;width:100%;max-width:600px;height:auto;" /></a></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:4px;background-color:${accent};">&nbsp;</td></tr>` : ""}
<tr><td class="c" style="background-color:#0d0d0d;border-top:1px solid rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.06);"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td class="px" style="font-family:${MONO};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${accentText};padding:12px 0 12px 40px;">${escapeHtml(city || "")}${country ? `<span style="color:rgba(255,255,255,0.4);margin-left:6px;">, ${escapeHtml(country)}</span>` : ""}</td>
  <td class="px" align="right" style="font-family:${MONO};font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(255,255,255,0.3);padding:12px 40px 12px 0;">${frameCount ? `${escapeHtml(frameCount)} frames` : ""}${frameCount && dateLabel ? " &nbsp;&middot;&nbsp; " : ""}${escapeHtml(dateLabel)}</td>
</tr></table></td></tr>
<tr><td class="px" style="padding:40px 40px 28px;">
  <div style="font-family:${MONO};font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${accentText};margin-bottom:18px;">New Shoot &middot; Photography</div>
  <h1 class="t1" style="margin:0 0 22px;font-family:${SERIF};font-size:48px;font-weight:400;line-height:0.96;letter-spacing:-0.02em;color:#ffffff;">${escapeHtml(title)}</h1>
  <div style="font-family:${MONO};font-size:13.5px;line-height:1.76;color:rgba(255,255,255,0.6);">${nl2p(description, "margin:0 0 14px;")}${note ? nl2p(note, "margin:0 0 14px;color:rgba(255,255,255,0.75);") : ""}</div>
</td></tr>
<tr><td class="px" style="padding:0 40px 28px;border-bottom:1px solid rgba(255,255,255,0.06);">
  ${[["Location", place], ["Frames", frameCount], ["Date", dateLabel]].filter(([, value]) => cleanString(value)).map(([key, value]) => `<div style="display:inline-block;vertical-align:top;margin:0 32px 8px 0;"><span style="display:block;font-family:${MONO};font-size:9px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-bottom:4px;">${key}</span><span style="font-family:${MONO};font-size:13px;letter-spacing:0.06em;color:rgba(255,255,255,0.7);">${escapeHtml(value)}</span></div>`).join("")}
</td></tr>
${tagList.length ? `<tr><td class="px" style="padding:22px 40px;border-bottom:1px solid rgba(255,255,255,0.06);">${tagList.map((tag) => `<span style="display:inline-block;font-family:${MONO};font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${accentText};border:1px solid ${accent};padding:5px 12px;margin:0 8px 8px 0;">${escapeHtml(tag)}</span>`).join("")}</td></tr>` : ""}
<tr><td class="px" style="padding:32px 40px 44px;"><a href="${escapeHtml(link)}" style="display:inline-block;background-color:${accent};color:#ffffff;font-family:${MONO};font-size:11px;letter-spacing:0.2em;text-transform:uppercase;padding:14px 32px;">View the Shoot &rarr;</a></td></tr>
${archiveGrid}
<tr><td class="px" style="padding:22px 40px 36px;border-top:1px solid rgba(255,255,255,0.06);">
  <div style="font-family:${MONO};font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin-bottom:10px;">SEEN FELT KEPT &nbsp;&middot;&nbsp; Stories From Abroad</div>
  <p style="margin:0;font-family:${MONO};font-size:11px;line-height:1.7;color:rgba(255,255,255,0.35);">You subscribed to photography updates.<br>${footerLinks(baseUrl, "rgba(255,255,255,0.5)")}</p>
</td></tr>
</table>`;

  const html = renderShell({ title, preheader: preheaderText, fontsHref: FONTS.photo, bodyRows, wrapperBg: "#080808" });
  const text = [
    `New Shoot: ${title}`, [place, frameCount ? `${frameCount} frames` : "", dateLabel].filter(Boolean).join(" · "), "",
    plainText(description), note ? plainText(note) : "", "",
    `View the shoot: ${link}`,
    ...textFooter(baseUrl),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Faces of the World (warm dark portrait design)
// ---------------------------------------------------------------------------
export function buildFacesEmail(ctx) {
  const {
    subject, note, baseUrl, slug,
    name, age, city, country, occupation, excerpt, fieldNote, dateMet, portraitUrl, portraitAlt,
  } = ctx;
  const link = buildContentUrl(baseUrl, "faces", slug);
  const preheaderText = plainText(excerpt).slice(0, 140) || subject;
  const location = [cleanString(city), cleanString(country)].filter(Boolean).join(", ");
  const JO = "'Josefin Sans',Arial,sans-serif";
  const details = [cleanString(age), location, cleanString(occupation)].filter(Boolean);
  const paragraphs = (Array.isArray(fieldNote) ? fieldNote : []).filter(Boolean).slice(0, 2);
  const metaItems = [["Location", location], ["Met", formatLongDate(dateMet)]].filter(([, value]) => cleanString(value));

  const bodyRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#16120d;">
<tr><td class="px" style="padding:36px 48px 28px;border-bottom:1px solid rgba(245,232,208,0.1);">
  <div style="font-family:${JO};font-size:10px;font-weight:300;letter-spacing:0.28em;text-transform:uppercase;color:rgba(245,232,208,0.4);margin-bottom:10px;">&#9672; &nbsp; Portrait Series</div>
  <div style="font-family:${JO};font-size:13px;font-weight:300;letter-spacing:0.22em;text-transform:uppercase;color:rgba(245,232,208,0.65);">Faces of the World &middot; Stories From Abroad</div>
</td></tr>
<tr><td class="px" style="padding:44px 48px 0;">
  ${portraitUrl ? `<a href="${escapeHtml(link)}" style="display:block;margin-bottom:28px;"><img src="${escapeHtml(portraitUrl)}" alt="${escapeHtml(portraitAlt || name || "")}" width="504" style="display:block;width:100%;height:auto;" /></a>` : ""}
  <h1 class="t1" style="margin:0 0 6px;font-family:${LO};font-size:38px;font-weight:400;line-height:1.1;color:#f5e8d0;letter-spacing:-0.01em;">${escapeHtml(name)}</h1>
  ${details.length ? `<div style="font-family:${JO};font-size:11px;font-weight:300;letter-spacing:0.2em;text-transform:uppercase;color:rgba(245,232,208,0.5);margin-bottom:32px;">${details.map((item, index) => index === 0 && cleanString(age) ? `<span style="color:#c47e4a;">${escapeHtml(item)}</span>` : escapeHtml(item)).join(" &nbsp;&middot;&nbsp; ")}</div>` : ""}
</td></tr>
${excerpt ? `<tr><td class="px" style="padding:0 48px;"><div style="padding:28px 28px;background-color:#1e1710;border-left:2px solid #c47e4a;margin-bottom:32px;">
  <p style="margin:0 0 14px;font-family:${LO};font-size:21px;font-style:italic;line-height:1.55;color:#f5e8d0;">&ldquo;${escapeHtml(excerpt)}&rdquo;</p>
  <div style="font-family:${JO};font-size:10px;font-weight:300;letter-spacing:0.2em;text-transform:uppercase;color:#c47e4a;">&mdash; ${escapeHtml(name)}</div>
</div></td></tr>` : ""}
${paragraphs.length || note ? `<tr><td class="px" style="padding:0 48px 40px;">
  <div style="font-family:${JO};font-size:10px;font-weight:300;letter-spacing:0.24em;text-transform:uppercase;color:rgba(245,232,208,0.4);margin-bottom:18px;">Field Note</div>
  ${paragraphs.map((para) => `<p style="margin:0 0 16px;font-family:${LO};font-size:17px;line-height:1.78;color:rgba(245,232,208,0.8);">${escapeHtml(para)}</p>`).join("")}
  ${note ? nl2p(note, `margin:0 0 16px;font-family:${LO};font-size:17px;line-height:1.78;color:rgba(245,232,208,0.8);`) : ""}
</td></tr>` : ""}
${metaItems.length ? `<tr><td class="px" style="padding:0 48px 32px;"><div style="padding:16px 24px;border:1px solid rgba(245,232,208,0.14);">${metaItems.map(([key, value]) => `<div style="display:inline-block;vertical-align:top;margin-right:32px;"><span style="display:block;font-family:${JO};font-size:9px;letter-spacing:0.24em;text-transform:uppercase;color:rgba(245,232,208,0.4);margin-bottom:4px;">${key}</span><span style="font-family:${LO};font-size:14px;color:rgba(245,232,208,0.75);">${escapeHtml(value)}</span></div>`).join("")}</div></td></tr>` : ""}
<tr><td class="px" style="padding:0 48px 48px;"><a href="${escapeHtml(link)}" style="display:inline-block;border:1px solid rgba(196,126,74,0.6);color:#c47e4a;font-family:${JO};font-size:11px;font-weight:300;letter-spacing:0.2em;text-transform:uppercase;padding:13px 28px;">Read the full story &rarr;</a></td></tr>
<tr><td class="px" style="padding:24px 48px 40px;border-top:1px solid rgba(245,232,208,0.1);">
  <div style="font-family:${JO};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(245,232,208,0.3);margin-bottom:10px;">&#9672; Faces of the World &mdash; Stories From Abroad</div>
  <p style="margin:0;font-family:${JO};font-size:12px;font-weight:300;line-height:1.7;color:rgba(245,232,208,0.4);">You subscribed to portrait updates from Stories From Abroad.<br>${footerLinks(baseUrl, "rgba(245,232,208,0.55)")}</p>
</td></tr>
</table>`;

  const html = renderShell({ title: name, preheader: preheaderText, fontsHref: FONTS.faces, bodyRows, wrapperBg: "#16120d" });
  const text = [
    `Faces of the World: ${name}`, details.join(" · "), "",
    excerpt ? `"${plainText(excerpt)}"` : "", "",
    ...paragraphs, note ? plainText(note) : "", "",
    `Read their story: ${link}`,
    ...textFooter(baseUrl),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Dispatch / Travel -- "The Scrap Sheet" (dark ink header, red accents)
// ---------------------------------------------------------------------------
function globeGlyph(longitude) {
  const lng = Number(longitude);
  if (!Number.isFinite(lng)) return "&#127757;";
  if (lng < -30) return "&#127758;"; // Americas
  if (lng < 60) return "&#127757;"; // Europe / Africa
  return "&#127759;"; // Asia / Australia
}

function formatCoordinate(value, positive, negative) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `${Math.abs(num).toFixed(1)}&deg;${num >= 0 ? positive : negative}`;
}

export function buildDispatchEmail(ctx) {
  const {
    subject, note, baseUrl, slug,
    title, location, date, preview, photos, categoryLabel, longitude, latitude, dispatchNumber, totalDispatches, globeUrl,
  } = ctx;
  const link = buildContentUrl(baseUrl, "travel", slug);
  const preheaderText = plainText(preview).slice(0, 140) || subject;
  const place = cleanString(location);
  const city = place.split(",")[0].trim();
  const dateLabel = formatLongDate(date);
  const photoList = (Array.isArray(photos) ? photos : []).filter((photo) => photo && photo.url).slice(0, 6);
  const coords = [formatCoordinate(latitude, "N", "S"), formatCoordinate(longitude, "E", "W")].filter(Boolean).join(" ");
  const kindLabel = cleanString(categoryLabel);
  const RED = "#CC1111";

  let photoRows = "";
  for (let index = 0; index < photoList.length; index += 2) {
    const cell = (photo, padRight) => photo
      ? `<td class="stack" width="50%" valign="top" style="padding:0 ${padRight}px 14px 0;"><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.title || "")}" width="250" style="display:block;width:100%;height:150px;object-fit:cover;" />${photo.title ? `<div style="font-family:${CG};font-size:12px;letter-spacing:0.06em;color:#7A7570;padding-top:6px;">${escapeHtml(photo.title)}</div>` : ""}</td>`
      : `<td class="stack" width="50%"></td>`;
    photoRows += `<tr>${cell(photoList[index], 7)}${cell(photoList[index + 1], 0)}</tr>`;
  }

  const tags = [kindLabel, city].filter(Boolean);

  const bodyRows = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FAFAF7;">
<tr><td class="px" style="background-color:#111110;border-top:3px solid ${RED};padding:32px 44px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;"><tr>
    <td style="font-family:${CG};font-style:italic;font-size:11px;letter-spacing:0.1em;color:rgba(250,250,247,0.5);">Stories From Abroad</td>
    ${dispatchNumber ? `<td align="right" style="font-family:${CG};font-size:10px;letter-spacing:0.28em;text-transform:uppercase;color:${RED};">Dispatch No. ${escapeHtml(dispatchNumber)}</td>` : ""}
  </tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="top" width="124" style="padding-right:16px;">${globeUrl ? `<img src="${escapeHtml(globeUrl)}" width="108" height="108" alt="Globe pinned to ${escapeHtml(place)}" style="display:block;width:108px;height:108px;" />` : `<div style="width:96px;height:96px;border:1px solid #3a3a3a;border-radius:48px;background-color:#1a1a1a;text-align:center;"><div style="padding-top:14px;font-size:46px;line-height:50px;">${globeGlyph(longitude)}</div>${coords ? `<div style="font-family:Georgia,serif;font-size:8px;letter-spacing:0.08em;color:${RED};padding-top:4px;line-height:10px;">&#9679; ${coords}</div>` : ""}</div>`}</td>
    <td valign="middle">
      <div class="t3" style="font-family:${CG};font-size:28px;font-weight:300;font-style:italic;line-height:1.1;color:#FAFAF7;margin-bottom:8px;">Scrap Notes<br>from the road.</div>
      ${place ? `<div style="font-family:${CG};font-size:9.5px;letter-spacing:0.38em;text-transform:uppercase;color:rgba(250,250,247,0.45);margin-bottom:14px;">Written from ${escapeHtml(place)}</div>
      <div style="display:inline-block;background-color:#2a1414;border:1px solid #5a1a1a;color:${RED};font-family:${CG};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;padding:4px 12px;">&#9671; &nbsp;${escapeHtml(place)}</div>` : ""}
    </td>
  </tr></table>
</td></tr>
<tr><td class="px" style="background-color:#111110;border-bottom:3px solid ${RED};padding:0 44px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td width="84" valign="middle" style="padding-right:18px;"><div style="width:68px;height:68px;border:2px dashed ${RED};border-radius:38px;text-align:center;"><div style="padding-top:17px;font-family:Georgia,serif;font-style:italic;font-size:9px;letter-spacing:0.2em;color:${RED};">DISPATCH</div><div style="padding-top:4px;font-family:Georgia,serif;font-weight:bold;font-size:15px;color:${RED};">${dispatchNumber ? `No. ${escapeHtml(dispatchNumber)}` : "&#9679;"}</div></div></td>
  <td valign="middle"><div style="font-family:${CG};font-size:9.5px;letter-spacing:0.32em;text-transform:uppercase;color:rgba(250,250,247,0.45);margin-bottom:6px;">${[dateLabel, place ? `Filed from ${place}` : ""].filter(Boolean).map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}</div>${dispatchNumber && totalDispatches ? `<div style="font-family:${CG};font-size:13px;letter-spacing:0.08em;color:rgba(250,250,247,0.7);font-style:italic;">No. ${escapeHtml(dispatchNumber)} of <span style="font-style:normal;font-size:11px;letter-spacing:0.14em;color:rgba(250,250,247,0.45);">${escapeHtml(totalDispatches)} dispatches filed</span></div>` : ""}</td>
</tr></table></td></tr>
${note ? `<tr><td class="px" style="padding:36px 44px 30px;border-bottom:1px solid #E2DDD4;">
  <div class="wide" style="font-family:${CG};font-size:9.5px;letter-spacing:0.42em;text-transform:uppercase;color:#7A7570;margin-bottom:16px;">${lead("#7A7570", 20)}A note from BTG</div>
  ${nl2p(note, `margin:0 0 16px;font-family:${LO};font-size:15px;line-height:1.82;color:#2E2C28;`)}
  <p style="margin:20px 0 0;font-family:${LO};font-style:italic;font-size:16px;color:#7A7570;">Until the next one,<br><strong style="font-style:normal;font-weight:500;color:#2E2C28;font-family:${CG};font-size:14px;letter-spacing:0.08em;">BTG</strong></p>
</td></tr>` : ""}
<tr><td>${ruleRow({
    left: "&#9671; &nbsp; The Dispatch", right: escapeHtml(kindLabel), labelStyle: `font-family:${CG};font-size:9.5px;letter-spacing:0.4em;text-transform:uppercase;color:${RED};`,
    lineColor: "#E2DDD4", padY: 16, padX: 44, bg: "#F2F0EB", borders: "border-top:1px solid #E2DDD4;border-bottom:1px solid #E2DDD4;",
  })}</td></tr>
<tr><td class="px" style="padding:34px 44px 32px;">
  <div class="wide" style="font-family:${CG};font-size:9.5px;letter-spacing:0.46em;text-transform:uppercase;color:${RED};margin-bottom:16px;">${lead(RED, 20)}${[dateLabel, place].filter(Boolean).map(escapeHtml).join(" &nbsp;&middot;&nbsp; ")}</div>
  <h1 class="t2" style="margin:0 0 26px;font-family:${CG};font-size:33px;font-weight:400;font-style:italic;line-height:1.15;color:#111110;letter-spacing:-0.01em;">${escapeHtml(title)}</h1>
  ${nl2p(preview, `margin:0 0 18px;font-family:${LO};font-size:15px;line-height:1.84;color:#2E2C28;`)}
  ${photoRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">${photoRows}</table>` : ""}
</td></tr>
<tr><td class="px" style="padding:4px 44px 44px;"><a href="${escapeHtml(link)}" style="display:inline-block;background-color:${RED};color:#FAFAF7;font-family:${CG};font-size:11px;letter-spacing:0.3em;text-transform:uppercase;padding:13px 28px;">Continue reading &rarr;</a></td></tr>
${tags.length ? `<tr><td class="px" style="padding:0 44px 36px;border-bottom:1px solid #E2DDD4;">${tags.map((tag) => `<span style="display:inline-block;font-family:${CG};font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#7A7570;border:1px solid #E2DDD4;padding:4px 11px;margin:0 7px 7px 0;">${escapeHtml(tag)}</span>`).join("")}</td></tr>` : ""}
<tr><td class="px" style="background-color:#111110;padding:22px 44px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
  <td style="font-family:${CG};font-style:italic;font-size:11px;letter-spacing:0.1em;color:rgba(250,250,247,0.4);">The Scrap Sheet</td>
  <td align="right" style="font-family:${CG};font-size:10px;letter-spacing:0.12em;color:rgba(250,250,247,0.4);">${footerLinks(baseUrl, "rgba(250,250,247,0.5)")}</td>
</tr></table></td></tr>
</table>`;

  const html = renderShell({ title, preheader: preheaderText, fontsHref: FONTS.general, bodyRows, wrapperBg: "#FAFAF7" });
  const text = [
    `Dispatch${dispatchNumber ? ` No. ${dispatchNumber}` : ""}: ${title}`, [dateLabel, place].filter(Boolean).join(" · "), "",
    note ? `A note from BTG: ${plainText(note)}\n` : "",
    plainText(preview), "",
    `Read the full dispatch: ${link}`,
    ...textFooter(baseUrl),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
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
