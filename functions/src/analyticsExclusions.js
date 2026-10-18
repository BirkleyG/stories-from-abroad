// Addresses that never count toward analytics (the site owner's own inboxes).
export const ANALYTICS_EXCLUDED_EMAILS = new Set(["birkley.grunewald@gmail.com"]);

export function isAnalyticsExcluded(email) {
  return ANALYTICS_EXCLUDED_EMAILS.has(String(email || "").trim().toLowerCase());
}
