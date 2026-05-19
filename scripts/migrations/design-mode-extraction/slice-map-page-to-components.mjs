/**
 * One-off: slices apps/web/src/app/map/page.tsx by 1-based line ranges into JSX bodies.
 * Outputs `_generated_*.txt` under scripts/migrations/design-mode-extraction/_generated_map_page_fragments/.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..', '..');

const PAGE = path.join(root, 'apps/web/src/app/map/page.tsx');

const slice = (start, end) => {
  const lines = fs.readFileSync(PAGE, 'utf8').split(/\r?\n/);
  return lines.slice(start - 1, end).join('\n');
};

const MAP_COMPONENT_DIR = path.join(__dirname, '_generated_map_page_fragments');

/** @type {Record<string, { start: number; end: number }>} */
const regions = {};

// Equipment HUD (topologyRendered conditional block)
regions.equipmentHud = { start: 155, end: 246 };

// Inner basemap toggle row only (omit outer positioned column wrapper)
regions.basemapRow = { start: 425, end: 455 };

// Panel type buttons column only
regions.panelButtons = { start: 457, end: 499 };

// Flyout chrome + conditional panels wrapper: from scroll open through calc panel close before </div></div>
regions.flyoutScrollOpen = { start: 552, end: 2886 };

// Legend inner (padding 16 wrapper)
regions.legendInner = { start: 554, end: 791 };

// Layers inner (padding 16 wrapper)
regions.layerInner = { start: 795, end: 991 };

// Calc: line 994 is `{activePanel === 'calc' && (`, 995 opens padding div — export splice at 1391-1493
regions.calcCalcOpen = { start: 994, end: 1390 };
regions.calcExport = { start: 1391, end: 1493 };
regions.calcRest = { start: 1494, end: 2886 };

regions.searchBar = { start: 248, end: 412 };

regions.loadingOverlay = { start: 2891, end: 2911 };

regions.calcGhostBar = { start: 2913, end: 2934 };

regions.mapStylesInner = { start: 112, end: 151 };

for (const [name, r] of Object.entries(regions)) {
  fs.writeFileSync(path.join(MAP_COMPONENT_DIR, `_generated_${name}.txt`), slice(r.start, r.end), 'utf8');
}

console.log('Wrote _generated_*.txt under', MAP_COMPONENT_DIR);
