# Design System & Project Guidelines for changemynameuk.com

Written by Avi (25 Nov 2026), adapted to how the site is actually built. Claude and anyone else changing the site follow these rules.

## Core Stack & Architecture
- **Framework:** Astro (static pages), with React only for components designed in Subframe. React renders to plain HTML at build time; no React is sent to visitors unless a component is marked `client:load`.
- **Styling:** Tailwind CSS v4 for Subframe pages (`src/layouts/SubframeLayout.astro`). Pages not yet redesigned still use `public/style.css` through `src/layouts/Base.astro`.
- **UI Component Engine:** Subframe (visual design system), project "Change My Name UK" (https://app.subframe.com/00773a7ca3a0).
- **Content:** page words live in this repository (`src/content/` Markdown and the `.astro` pages), edited from Claude, not in Subframe.
- **Deployment:** Netlify via GitHub auto-build (`npm run build` to `dist/`).

---

## 🎨 Subframe & UI Guardrails (STRICT)

### 1. File Isolation
- **Subframe Core Directory:** `src/ui/` (set in `.subframe/sync.json`)
  - 🛑 **NEVER** edit, modify, or re-style the generated files in `src/ui/` (`theme.css`, `utils.ts`, `index.ts`, `components/*/<Name>.tsx`).
  - These files are generated and synced by Subframe (`npm run subframe:sync`). Hand-edits are overwritten on the next sync. Change the design in Subframe, then sync.
- **Application Wrappers:** `src/components/` and `src/features/`
  - Put logic wrapper components in `src/components/` (or `src/features/<feature>/` for a larger feature) that import and wrap the base Subframe components from `@/ui`.
  - Page sections rebuilt from a Subframe page design go in `src/designs/`.

### 2. Styling & Design Tokens
- **Design Tokens:** always use the Subframe theme tokens and Tailwind utility classes from the design system, never hardcoded hex values (`#1B2A4A`, `#FAF9F6`).
  - Headings: `text-heading-1 font-heading-1` (also `heading-2`, `heading-3`): Playfair Display
  - Body: `text-body font-body`, `text-lede font-lede`, `text-small font-small`: Plus Jakarta Sans
  - Labels: `text-monospace-body font-monospace-body`: IBM Plex Mono. Logo: `text-logo font-logo` (Fraunces). Handwritten notes: `text-hand font-hand` (Caveat)
  - Colours: `bg-navy` / `text-default-font` (Oxford Navy), `bg-cream` / `bg-default-background` (cream), `bg-stone` (cards), `bg-brand-primary` / `text-brand-primary` (rose buttons), `text-wax` (eyebrows, notes), `border-neutral-border` (borders), `bg-sage`, `bg-blush`, plus the `brand-50…900` and `neutral-0…950` scales
  - Corners: `rounded-sm` (8px), `rounded-md` (12px), `rounded-lg` (16px). Shadows: `shadow-default`, `shadow-lg`
  - Mobile: use the `mobile:` prefix (767px and narrower), not `sm:`/`md:`
- **Layout Integrity:** preserve Subframe flexbox and grid gaps (`gap-4`, `gap-6`, `p-8`). Do not add inline fixed widths or absolute positioning unless explicitly instructed.

### 3. Business Logic vs. Presentation
- Keep Subframe components purely presentational.
- Wire up form states, routing, API calls, and PDF/document generation strictly inside the outer wrapper component or custom hooks (for example `src/features/name-change/useNameChangeForm.ts`).
- Netlify forms must keep `data-netlify="true"`, their `name` and every field in the HTML (Netlify only stores fields present at build time).
- Keep every page's address, `<head>` tags (via `src/components/SeoHead.astro`) and analytics when a page moves to a Subframe design.

---

## 🇬🇧 Tone & Product Micro-Copy Rules
- Target audience: UK women changing their name after their wedding, or going back to their name after divorce.
- Visual & tonal register: professional, warm British English (use *Deed Poll*, *Marriage Certificate*, *Final Order*, *DVLA*, *HMRC*, *HM Passport Office*).
- Never introduce generic American terms (for example "Postcode" not "Zip Code", "Surname" not "Last Name").

---

## 🛠 CLI & Git Instructions
- When making UI or logic changes, touch only the specific components named in the request.
- Before committing, review the diff and run `npm run build`; for UI changes, check the affected pages visually (desktop and mobile).
