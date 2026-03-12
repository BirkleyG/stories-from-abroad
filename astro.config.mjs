import { defineConfig } from "astro/config";
import react from "@astrojs/react";

const isProd = process.env.NODE_ENV === "production";
const base =
  process.env.ASTRO_BASE && process.env.ASTRO_BASE !== ""
    ? process.env.ASTRO_BASE
    : isProd
      ? "/stories-from-abroad/"
      : "/";
const site =
  process.env.SITE_URL && process.env.SITE_URL !== ""
    ? process.env.SITE_URL
    : isProd
      ? "https://BirkleyG.github.io/stories-from-abroad/"
      : undefined;

export default defineConfig({
  site,
  base,
  integrations: [react()],
});
