# BrightPath frontend: rules

We own **only `frontend/`**. Never edit `backend/`, `docs/openapi.json` or `frontend/src/api/schema.d.ts` (it is generated). If the API is missing something, raise it with the backend owner; do not work around it.

## Stack and commands
- React Router 7 (framework mode, SSR), Vite, React 19, TypeScript, Tailwind CSS v4, oxlint.
- **bun only, never npm.** `bun run dev` · `bun run build` · `bun run start` · `bun run typecheck` · `bun run lint`.
- App code lives in `src/` (`appDirectory`): `root.tsx`, `routes.ts`, `routes/*`, `api/`, `styles/`.
- Before saying a change is done, check exit codes: `bun run typecheck; echo $?`, lint and build must all pass with no warnings.

## Scope
- The scope is the page list in the PRD (`../_reference/docs/PRD.md`, section "Pages"): Home, NEET Rank Predictor, College Finder, Compare, Country, College (abroad and India), State counselling, NEET guide, About, Contact, Privacy, Terms, Disclaimer, the enquiry form, header, menus, tab bar and footer.
- **Out of scope:** partner/B2B portal, commissions and payments, chatbot, news, student accounts and saved shortlists. Do not build or stub them.
- Menus show only pages that are published. Never link to a page that does not exist.

## Design
- The v3 "passport" design is fixed: `../_reference/design/design-handoff-v3/` (DESIGN.md, PRODUCT.md, `src/site.css`, `src/pages/*.html`). The built previews in `dist/*.html` are the visual reference at 360 px and 1280 px.
- Tokens are in `src/styles/tokens.css` (same names and values as site.css `:root`). Component styles are in `src/styles/components.css`, copied verbatim. Do not change either without a written design decision. Add any missing v3 component by copying it verbatim from the reference.
- Fonts (Archivo, Martian Mono) are self-hosted from `src/styles/fonts/`. No font CDNs.
- No gradients, glows, emoji icons, stock or AI images, fake stats, testimonials, ratings, countdowns or pop-ups on load. Vermilion (`--action`) is only for the primary action.

## Wording (never retype)
- The disclaimer texts (`NOT_GUARANTEED`, `FOREIGN_COLLEGES_NMC`, `ENQUIRY_CONSENT`) and the regulator line come from **`GET /site/config` → `disclaimers`**. Never hard-code, paraphrase or fall back to a copy of them. If one is missing, show a visible error.
- **A foreign college is never "NMC approved"** (also never "WHO approved" or "MCI approved"). Indian colleges: "Recognised by NMC". Foreign colleges: "Listed in WDOMS", "Meets NMC 2021 rules", "NMC alert" / "No NMC alert found".
- Brand name, phone, email and address come from `/site/config`. Show labelled placeholders while they are null.

## API
- Types come **only** from `src/api/schema.d.ts`. Regenerate it with `bun run gen:api` from the repo root and never hand-write API types.
- Call the API through `src/api/client.server.ts` (openapi-fetch) from route loaders and actions on the server, and use `unwrap()` so error envelopes reach the ErrorBoundary.
- Admin calls need `credentials: "include"` and `X-BP-Admin: 1` on every non-GET `/admin/*` request.

## Reference material
- `../_reference/` is read-only design and product material, and it is git-ignored. Never commit it or copy it wholesale. Copy only the specific tokens, styles, fonts or assets you need.
