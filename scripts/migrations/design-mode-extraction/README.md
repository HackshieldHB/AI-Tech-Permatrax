# Design-mode — archived Phase A tooling (do not use for day-to-day work)

## Source of truth

The **current** GIS map implementation that the app runs lives under:

- `apps/web/src/app/map/page.tsx`
- `apps/web/src/app/map/components/*`
- `apps/web/src/app/map/hooks/*`

Those files are what you edit for features and fixes. Anything in this folder is **not** part of the production map UI.

## What this folder contains

Scripts and fragments here were **one-time helpers** used while splitting the giant map page (hook extraction earlier, JSX extraction via `compose-map-view-phase-a.mjs`). They exist only so the extraction can be **reconstructed or audited historically**.

## Do not re-run these scripts

**Do not re-run** the `.mjs` tools in production workflows or CI. They overwrite `apps/web/src/app/map/page.tsx` and `components/*.tsx` when pointed at the old monolithic line layout; you will corrupt the tree unless you fully understand and repair paths and prerequisites.

Archived materials (`_generated_map_page_fragments/`, `_extract_fragments_map/`, `_slices/`, **`page.pre-refactor.tsx`**) are **reference-only** snapshots (snapshots also remain in git history). They are **not** sources you should edit or regenerate from casually.

Contents (reference):

- `compose-map-view-phase-a.mjs` — regenerator (**monolithic** `page.tsx` required first; typically after `restore-map-page-from-fragments.mjs`).
- `restore-map-page-from-fragments.mjs` — rebuilds monolithic `page.tsx` from `_generated_map_page_fragments/_generated_*.txt` plus `_extract_fragments_map/fragment_panelFlyoutShellHeader.txt`.
- `slice-map-page-to-components.mjs` / `extract-map-components.mjs` — optional line-slice helpers (line ranges may be stale).
- `_extract.mjs`, `assemble-map-hooks.mjs`, `build-hooks.mjs`, `build-useCalculation.mjs`, `splice-page.mjs` — legacy hook splice generators (paths/snippet assumptions may be stale).
- `_slices/` — shards for the assemble scripts above.
- `page.pre-refactor.tsx` — large pre–hook-split copy (historical only).
