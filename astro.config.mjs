import { defineConfig } from "astro/config";

const base = process.env.ASTRO_BASE && process.env.ASTRO_BASE !== "" ? process.env.ASTRO_BASE : "/";
const site = process.env.SITE_URL && process.env.SITE_URL !== "" ? process.env.SITE_URL : undefined;

export default defineConfig({
  site,
  base,
});
