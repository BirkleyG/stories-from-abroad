import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";

const isProd = process.env.NODE_ENV === "production";
const base =
  process.env.ASTRO_BASE && process.env.ASTRO_BASE !== ""
    ? process.env.ASTRO_BASE
    : isProd
      ? "/"
      : "/";
const site =
  process.env.SITE_URL && process.env.SITE_URL !== ""
    ? process.env.SITE_URL
    : isProd
      ? "https://storiesfromabroad.com/"
      : undefined;

export default defineConfig({
  site,
  base,
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/\/(admin|subscriber-settings|unsubscribe|email-verified|404)\/?$/.test(page),
    }),
  ],
});
