/**
 * One-shot: extracts verbatim JSX slices from page.tsx before manual prop typing.
 * Do not run as part of build — archived with this migration folder.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapDir = path.resolve(__dirname, '../../../apps/web/src/app/map');
const pagePath = path.join(mapDir, 'page.tsx');
const outDir = path.join(mapDir, 'components/_extract_fragments');
fs.mkdirSync(outDir, { recursive: true });

const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

/** 1-based inclusive line nums from GIS page prior to extraction audit */
fs.writeFileSync(path.join(outDir, 'fragment_equipmentHud.txt'), slice(155, 246), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_searchBar.txt'), slice(248, 412), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_basemapSwitcher.txt'), slice(425, 454), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_panelButtons.txt'), slice(457, 499), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_panelFlyoutShellHeader.txt'), slice(502, 550), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_legendInner.txt'), slice(554, 791), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_layerInner.txt'), slice(794, 991), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_calcInner.txt'), slice(995, 2885), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_loadingOverlay.txt'), slice(2891, 2911), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_calcGhostBar.txt'), slice(2913, 2934), 'utf8');
fs.writeFileSync(path.join(outDir, 'fragment_mapStylesInner.txt'), slice(112, 151), 'utf8');

console.log('fragments written to', outDir);
