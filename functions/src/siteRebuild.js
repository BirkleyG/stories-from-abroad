import { logger } from "firebase-functions";

// Kinds that have a prerendered public page and therefore need a site rebuild.
const REBUILD_KINDS = new Set(["papers", "photography", "faces"]);
const REPO = "BirkleyG/stories-from-abroad";
const WORKFLOW = "deploy.yml";

// Fire the GitHub Pages deploy workflow so per-item pages and the sitemap pick up new content.
// Never throws: a failed rebuild must not fail the publish itself.
export async function triggerSiteRebuild(kind, token) {
  if (!REBUILD_KINDS.has(kind)) return { triggered: false, reason: "kind-not-prerendered" };
  if (!token) {
    logger.warn("Site rebuild skipped: GITHUB_DISPATCH_TOKEN secret is not set.", { kind });
    return { triggered: false, reason: "no-token" };
  }
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!response.ok) {
      logger.error("Site rebuild dispatch failed.", { kind, status: response.status, body: (await response.text()).slice(0, 300) });
      return { triggered: false, reason: `http-${response.status}` };
    }
    return { triggered: true };
  } catch (error) {
    logger.error("Site rebuild dispatch errored.", { kind, error: error.message });
    return { triggered: false, reason: "error" };
  }
}
