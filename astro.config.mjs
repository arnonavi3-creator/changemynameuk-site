// Astro builds the site into plain HTML files in dist/.
// build.format "preserve" keeps every page at its current address:
// src/pages/about/index.astro -> /about/, src/pages/privacy.astro -> /privacy.html
//
// Subframe: designs made in Subframe are React + Tailwind. The React integration
// renders them to plain HTML at build time (no JavaScript is sent to visitors
// unless a component is marked client:*), and Tailwind builds their styles.
// Tailwind is only loaded on pages that use src/layouts/SubframeLayout.astro,
// so pages on Base.astro keep using public/style.css exactly as before.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import rehypeExternalLinks from './src/plugins/rehype-external-links.mjs';

export default defineConfig({
  site: 'https://changemynameuk.com',
  output: 'static',
  trailingSlash: 'ignore',
  compressHTML: false,
  build: { format: 'preserve' },
  integrations: [react()],
  markdown: { rehypePlugins: [rehypeExternalLinks], smartypants: false },
  vite: {
    plugins: [tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
