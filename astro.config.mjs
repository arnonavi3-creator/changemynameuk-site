// Astro builds the site into plain HTML files in dist/ (no JavaScript is added).
// build.format "preserve" keeps every page at its current address:
// src/pages/about/index.astro -> /about/, src/pages/privacy.astro -> /privacy.html
import { defineConfig } from 'astro/config';
import rehypeExternalLinks from './src/plugins/rehype-external-links.mjs';

export default defineConfig({
  site: 'https://changemynameuk.com',
  output: 'static',
  trailingSlash: 'ignore',
  compressHTML: false,
  build: { format: 'preserve' },
  markdown: { rehypePlugins: [rehypeExternalLinks], smartypants: false },
});
