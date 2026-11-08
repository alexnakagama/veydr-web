// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Change this if the Vercel project gets a different *.vercel.app name.
const site = process.env.SITE_URL ?? 'https://veydr.vercel.app';

export default defineConfig({
  site,
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
