// Guides live as Markdown files in src/content/guides/ (one file per guide).
// The file name is the web address: honeymoon-passport.md -> /guides/honeymoon-passport/
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),                 // the H1 on the page
    metaTitle: z.string(),             // browser tab and Google title
    ogTitle: z.string(),               // title on Facebook/WhatsApp link previews
    description: z.string(),
    published: z.string(),             // YYYY-MM-DD
    updated: z.string(),               // YYYY-MM-DD, change when the content changes
    lede: z.string(),                  // intro paragraph (HTML allowed)
    sourcesChecked: z.string(),        // e.g. "24 October 2026"
    sources: z.array(z.object({ label: z.string(), url: z.string() })),
    relatedHeading: z.string().optional(), // defaults to "Related guides"
    related: z.array(z.object({ label: z.string(), href: z.string(), note: z.string() })).optional(),
    cta: z.object({ heading: z.string(), text: z.string(), button: z.string(), href: z.string(), note: z.string().optional() }),
    extraSchema: z.string().optional(), // extra structured data (JSON), e.g. FAQPage
  }),
});

export const collections = { guides };
