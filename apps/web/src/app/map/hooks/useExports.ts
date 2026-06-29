import type { RefObject } from 'react'; // FIX
import { useState } from 'react'; // FIX
import maplibregl from 'maplibre-gl'; // FIX
import JSZip from 'jszip'; // FIX
import type { TopoExportData } from './types'; // JLM Issue 1/2

// JLM Issue 2: escape XML/KML special characters
function escapeKml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// JLM Issue 2: serialise a coordinate path to KML "lng,lat,0 …" form
function kmlLine(coords: [number, number][]): string {
  return coords.map(([lng, lat]) => `${lng},${lat},0`).join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
// State ownership (Phase 1): topoExportData is owned by useTopologyRender and
// passed into callbacks here alongside mapRef/calcResult — never global.
// ════════════════════════════════════════════════════════════════════════════

// FIX: export map as PNG image
export async function exportMapImage(mapRef: RefObject<maplibregl.Map | null>, filename: string) {
  const map = mapRef.current; // FIX
  if (!map) throw new Error('Map not ready'); // FIX
  const canvas = map.getCanvas(); // FIX
  const dataUrl = canvas.toDataURL('image/png'); // FIX
  const a = document.createElement('a'); // FIX
  a.href = dataUrl; // FIX
  a.download = filename; // FIX
  document.body.appendChild(a); // FIX
  a.click(); // FIX
  document.body.removeChild(a); // FIX
} // FIX

// JLM Issue 2: export full topology (points + cable paths) as KMZ for Google Earth
export async function exportKmz(
  topologyData: TopoExportData, // FIX
  filename: string, // FIX
) {
  const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${escapeKml(filename)}</name>
<Style id="olt"><IconStyle><color>ffff0000</color><scale>1.4</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/electronics.png</href></Icon></IconStyle></Style>
<Style id="odc"><IconStyle><color>ffaa00ff</color><scale>1.2</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/square.png</href></Icon></IconStyle></Style>
<Style id="odp"><IconStyle><color>ff00aa00</color><scale>1.0</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/donut.png</href></Icon></IconStyle></Style>
<Style id="closure"><IconStyle><color>ff00a5ff</color><scale>0.9</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon></IconStyle></Style>
<Style id="homepass"><IconStyle><color>ff44cc22</color><scale>0.6</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Style id="homepass_uncovered"><IconStyle><color>ffafa39c</color><scale>0.6</scale><Icon><href>https://maps.google.com/mapfiles/kml/shapes/open-diamond.png</href></Icon></IconStyle></Style>
<Style id="feeder"><LineStyle><color>ff4444ef</color><width>4</width></LineStyle></Style>
<Style id="distribution"><LineStyle><color>fff6823b</color><width>2.5</width></LineStyle></Style>
`; // FIX

  let kmlBody = ''; // FIX

  // ── Cable paths (the part that was missing before) ──────────────────────────
  if (topologyData.feederCoords && topologyData.feederCoords.length >= 2) {
    kmlBody += `<Placemark><name>Kabel Feeder (OLT→ODC)</name><styleUrl>#feeder</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${kmlLine(topologyData.feederCoords)}</coordinates></LineString></Placemark>\n`; // FIX
  } // FIX
  if (topologyData.distRoutes) {
    topologyData.distRoutes.forEach((coords, i) => {
      if (coords.length >= 2) {
        kmlBody += `<Placemark><name>Kabel Distribusi ${i + 1}</name><styleUrl>#distribution</styleUrl>
          <LineString><tessellate>1</tessellate><coordinates>${kmlLine(coords)}</coordinates></LineString></Placemark>\n`; // FIX
      }
    }); // FIX
  } // FIX

  if (topologyData.backbone) {
    const [blng, blat] = topologyData.backbone; // FIX
    kmlBody += `<Placemark><name>OLT / Backbone</name><styleUrl>#olt</styleUrl>
      <description>Optical Line Terminal</description>
      <Point><coordinates>${blng},${blat},0</coordinates></Point></Placemark>\n`; // FIX
  } // FIX

  if (topologyData.odcPoint) {
    const [lng, lat] = topologyData.odcPoint; // FIX
    kmlBody += `<Placemark><name>ODC</name><styleUrl>#odc</styleUrl>
      <Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>\n`; // FIX
  } // FIX

  if (topologyData.odpPositions) {
    topologyData.odpPositions.forEach((pos: [number, number], i: number) => {
      const load = topologyData.odpLoad?.[i]; // FIX
      const cap = topologyData.odpCapacity; // FIX
      const usage = load != null && cap != null ? ` (${load}/${cap} port)` : ''; // FIX
      kmlBody += `<Placemark><name>ODP-${i + 1}</name><styleUrl>#odp</styleUrl>
        <description>${escapeKml(`ODP A${String(i + 1).padStart(2, '0')}${usage}`)}</description>
        <Point><coordinates>${pos[0]},${pos[1]},0</coordinates></Point></Placemark>\n`; // FIX
    }); // FIX
  } // FIX

  if (topologyData.closurePoints) {
    topologyData.closurePoints.forEach((pos, i) => {
      kmlBody += `<Placemark><name>Closure ${i + 1}</name><styleUrl>#closure</styleUrl>
        <Point><coordinates>${pos[0]},${pos[1]},0</coordinates></Point></Placemark>\n`; // FIX
    }); // FIX
  } // FIX

  if (topologyData.homepassPoints) {
    topologyData.homepassPoints.forEach((hp, i: number) => {
      const covered = hp.covered !== false; // FIX
      const styleId = covered ? 'homepass' : 'homepass_uncovered'; // FIX
      const desc = covered
        ? `Tercover${hp.odpIndex ? ` — ODP A${String(hp.odpIndex).padStart(2, '0')}` : ''}`
        : 'Tidak Tercover'; // FIX
      kmlBody += `<Placemark><name>HP-${i + 1}</name><styleUrl>#${styleId}</styleUrl>
        <description>${escapeKml(desc)}</description>
        <Point><coordinates>${hp.lng},${hp.lat},0</coordinates></Point></Placemark>\n`; // FIX
    }); // FIX
  } // FIX

  const kmlFooter = '</Document></kml>'; // FIX
  const kmlContent = kmlHeader + kmlBody + kmlFooter; // FIX

  const zip = new JSZip(); // FIX
  zip.file('doc.kml', kmlContent); // FIX
  const blob = await zip.generateAsync({ type: 'blob' }); // FIX
  const url = URL.createObjectURL(blob); // FIX
  const a = document.createElement('a'); // FIX
  a.href = url; // FIX
  a.download = `${filename}.kmz`; // FIX
  document.body.appendChild(a); // FIX
  a.click(); // FIX
  document.body.removeChild(a); // FIX
  URL.revokeObjectURL(url); // FIX
} // FIX

// JLM Issue 1: export calculation result to Excel (.xlsx) matching the JLM template
// Sheet 1 "Data List Customer" (raw rows) + Sheet 2 "DATA HOMEPASS" (pre-computed pivot).
export type ExcelAreaMeta = {
  name: string;
  rw: string;
  provinsi: string;
  kabupaten: string;
  kelurahan: string;
  kecamatan: string;
  alamat?: string;
};

export async function exportExcel(args: {
  homepass: Array<{ lat: number; lng: number; odpIndex?: number; covered?: boolean }>;
  meta: ExcelAreaMeta;
  filename: string;
}) {
  const XLSX = await import('xlsx');
  const odpLabel = (n: number) => `ODP A${String(n).padStart(2, '0')}`;
  const { meta } = args;

  // ── Sheet 1: Data List Customer (headers verbatim incl. template "Longtitude") ──
  const header = [
    'Name', 'RW', 'Name_Cst', 'Provinsi', 'Kabupaten', 'Kelurahan',
    'Kecamatan', 'Latitude', 'Longtitude', 'ODP', 'Keterangan', 'Alamat',
  ];
  const seqByOdp: Record<number, number> = {};
  const rows = args.homepass.map((hp) => {
    const covered = hp.covered !== false && hp.odpIndex != null;
    let nameCst = 'House';
    let odpCol = 'Tidak Tercover';
    let ket = 'Tidak Tercover';
    if (covered) {
      const n = hp.odpIndex as number;
      seqByOdp[n] = (seqByOdp[n] ?? 0) + 1;
      odpCol = odpLabel(n);
      nameCst = `${odpLabel(n)} .${seqByOdp[n]}`;
      ket = 'Tercover';
    }
    return [
      meta.name, meta.rw, nameCst, meta.provinsi, meta.kabupaten, meta.kelurahan,
      meta.kecamatan, hp.lat, hp.lng, odpCol, ket, meta.alamat ?? '',
    ];
  });
  const ws1 = XLSX.utils.aoa_to_sheet([header, ...rows]);

  // ── Sheet 2: DATA HOMEPASS pivot (dynamic ODP columns) ──────────────────────
  const coveredOdps = Array.from(
    new Set(args.homepass.filter((h) => h.covered !== false && h.odpIndex != null).map((h) => h.odpIndex as number)),
  ).sort((a, b) => a - b);
  const N = coveredOdps.length;
  const perOdp = coveredOdps.map((n) => args.homepass.filter((h) => h.covered !== false && h.odpIndex === n).length);
  const tercoverTotal = perOdp.reduce((a, b) => a + b, 0);
  const tidakCount = args.homepass.filter((h) => h.covered === false || h.odpIndex == null).length;
  const grand = tercoverTotal + tidakCount;

  const totalCols = N + 5; // Name | ODP×N | Tercover Total | Tidak Tercover | TT Total | Grand Total
  const blank = () => Array(totalCols).fill('') as (string | number)[];
  const row2 = blank(); row2[0] = 'Count of Keterangan'; row2[1] = 'Keterangan'; row2[2] = 'ODP';
  const row3 = blank(); row3[1] = 'Tercover'; row3[N + 1] = 'Tercover Total'; row3[N + 2] = 'Tidak Tercover'; row3[N + 3] = 'Tidak Tercover Total'; row3[N + 4] = 'Grand Total';
  const row4 = blank(); row4[0] = 'Name'; coveredOdps.forEach((n, i) => { row4[1 + i] = odpLabel(n); }); row4[N + 2] = 'Tidak Tercover';
  const dataRow = blank(); dataRow[0] = meta.name; perOdp.forEach((c, i) => { dataRow[1 + i] = c; }); dataRow[N + 1] = tercoverTotal; dataRow[N + 2] = tidakCount; dataRow[N + 3] = tidakCount; dataRow[N + 4] = grand;
  const grandRow = blank(); grandRow[0] = 'Grand Total'; perOdp.forEach((c, i) => { grandRow[1 + i] = c; }); grandRow[N + 1] = tercoverTotal; grandRow[N + 2] = tidakCount; grandRow[N + 3] = tidakCount; grandRow[N + 4] = grand;
  const ws2 = XLSX.utils.aoa_to_sheet([blank(), blank(), row2, row3, row4, dataRow, grandRow]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Data List Customer');
  XLSX.utils.book_append_sheet(wb, ws2, 'DATA HOMEPASS');
  XLSX.writeFile(wb, `${args.filename}.xlsx`);
} // FIX

// FIX: complete PDF export with proper layout
export async function exportPdf(
  type: 'pdf-map' | 'pdf-full', // FIX
  mapRef: RefObject<maplibregl.Map | null>, // FIX
  calcResult: any, // FIX
) {
  const { jsPDF } = await import('jspdf'); // FIX
  const ACCENT = [0, 212, 180] as [number, number, number]; // FIX: #00D4B4
  const DARK = [31, 41, 55] as [number, number, number]; // FIX: #1F2937
  const GRAY = [107, 114, 128] as [number, number, number]; // FIX
  const LIGHT_GRAY = [243, 244, 246] as [number, number, number]; // FIX

  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' }); // FIX
  const W = doc.internal.pageSize.getWidth(); // FIX
  const H = doc.internal.pageSize.getHeight(); // FIX
  const M = 14; // FIX: margin
  const CW = W - M * 2; // FIX: content width
  let pageNum = 1; // FIX

  // FIX: helper — draw page header
  const drawHeader = (title: string, pnum: number) => {
    doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]); // FIX: teal header bar
    doc.rect(0, 0, W, 14, 'F'); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setFontSize(11); // FIX
    doc.setTextColor(255, 255, 255); // FIX
    doc.text('PermaTrax — Kalkulasi Jaringan FTTH', M, 9.5); // FIX
    doc.setFontSize(9); // FIX
    doc.text(title, W - M, 9.5, { align: 'right' }); // FIX
    doc.setFontSize(7); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX: footer
    doc.text(`Generated: ${new Date().toLocaleString('id-ID')} | Halaman ${pnum}`, M, H - 4); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
  }; // FIX

  // FIX: helper — section title box
  const sectionTitle = (text: string, y: number): number => {
    doc.setFillColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]); // FIX
    doc.rect(M, y, CW, 7, 'F'); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setFontSize(9); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
    doc.text(text, M + 3, y + 5); // FIX
    return y + 10; // FIX
  }; // FIX

  // FIX: helper — key-value row
  const kvRow = (label: string, value: string, y: number, x = M, w = CW / 2): number => {
    doc.setFont('helvetica', 'normal'); // FIX
    doc.setFontSize(9); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
    doc.text(label, x, y); // FIX
    doc.setFont('helvetica', 'bold'); // FIX
    doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
    doc.text(value, x + w * 0.55, y); // FIX
    return y + 6; // FIX
  }; // FIX

  // FIX: ─── PAGE 1: MAP ─────────────────────────────
  drawHeader('Peta Jaringan', pageNum); // FIX

  const map = mapRef.current; // FIX
  if (map) {
    const canvas = map.getCanvas(); // FIX
    const imgData = canvas.toDataURL('image/jpeg', 0.92); // FIX: JPEG for smaller PDF
    const imgH = H - 22; // FIX: leave room for header + footer
    doc.addImage(imgData, 'JPEG', M, 17, CW, imgH); // FIX
  } else {
    doc.setFillColor(LIGHT_GRAY[0], LIGHT_GRAY[1], LIGHT_GRAY[2]); // FIX: placeholder
    doc.rect(M, 17, CW, H - 22, 'F'); // FIX
    doc.setFont('helvetica', 'normal'); // FIX
    doc.setFontSize(12); // FIX
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
    doc.text('Map tidak tersedia', W / 2, H / 2, { align: 'center' }); // FIX
  } // FIX

  if (type === 'pdf-full' && calcResult) {
    const s = calcResult.summary || {}; // FIX
    const hp = calcResult.homepass || {}; // FIX
    const rt = calcResult.route || {}; // FIX
    const cab = calcResult.cable || {}; // FIX
    const eq = calcResult.equipment || {}; // FIX
    const pb = calcResult.powerBudget || {}; // FIX

    // FIX: ─── PAGE 2: SUMMARY + EQUIPMENT ─────────────
    doc.addPage(); // FIX
    pageNum++; // FIX
    drawHeader('Ringkasan & Kebutuhan Perangkat', pageNum); // FIX

    let y = 20; // FIX

    const colW = (CW - 8) / 2; // FIX
    y = sectionTitle('Ringkasan Area', y); // FIX: ASCII section label for PDF font
    y = kvRow('Tipe Area', String(s.areaType || '-'), y, M, colW); // FIX
    y = kvRow('Kategori', `Kategori ${s.areaCategory || '-'}`, y, M, colW); // FIX
    y = kvRow('Homepass Estimasi', `${hp.estimated || 0} unit`, y, M, colW); // FIX
    y = kvRow(
      'Homepass Aktif',
      `${hp.active || 0} unit (${hp.takeRatePercent || 0}%)`,
      y,
      M,
      colW,
    ); // FIX
    y = kvRow('Total Route', `${((rt.totalM || 0) / 1000).toFixed(2)} km`, y, M, colW); // FIX
    y = kvRow('Total Kabel', `${((cab.totalM || 0) / 1000).toFixed(2)} km`, y, M, colW); // FIX
    y = kvRow('Backbone Distance', `${s.backboneDistanceM || 0} m`, y, M, colW); // FIX
    y = kvRow('Backbone Owner', String(s.backboneOwner || '-'), y, M, colW); // FIX

    y += 6; // FIX
    y = sectionTitle('Optical Power Budget', y); // FIX
    y = kvRow('GPON Class', String(pb.gponClass || 'Class B+ (28 dBm)'), y, M, colW); // FIX
    y = kvRow(
      'Cadangan Daya',
      `${pb.linkMarginDB || 0} dB ${pb.isOk ? 'OK' : 'Kurang'}`,
      y,
      M,
      colW,
    ); // FIX
    y = kvRow('Total Rugi Optik', `${pb.totalLossDB || 0} dB`, y, M, colW); // FIX
    y = kvRow('Splitter Loss', `${pb.breakdown?.splitterDB ?? 0} dB`, y, M, colW); // FIX
    y = kvRow('Serat Feeder', `${pb.breakdown?.seratFeederDB ?? 0} dB`, y, M, colW); // FIX
    y = kvRow('Konektor', `${pb.breakdown?.konektorDB ?? 0} dB`, y, M, colW); // FIX

    const rx = M + colW + 8; // FIX: RIGHT COLUMN
    let ry = 20; // FIX
    ry = sectionTitle('Kebutuhan Perangkat', ry); // FIX

    const eqRows: [string, string][] = [
      [
        'OLT',
        `1 unit (${eq.olt?.portsNeeded ?? 0} port) — ${eq.olt?.recommendation ?? ''}`,
      ], // FIX
      [`ODC ${eq.odc?.capacity ?? ''}`, `${eq.odc?.count ?? 0} unit`], // FIX
      [
        `ODP ${eq.odp?.capacity ?? ''}P`,
        `${eq.odp?.count ?? 0} unit (spacing ${eq.odp?.spacingM ?? 0}m)`,
      ], // FIX
      [`Splitter ${eq.splitter?.ratio ?? ''}`, `${eq.splitter?.count ?? 0} unit`], // FIX
      [
        'Closure',
        `${eq.closure?.total ?? 0} unit (${eq.closure?.inline ?? 0} inline)`,
      ], // FIX
      [
        'Tiang',
        `${eq.pole?.total ?? 0} unit (${eq.pole?.newBuild ?? 0} baru + ${eq.pole?.existing ?? 0} existing)`,
      ], // FIX
      ['Splice', `${eq.splice?.total ?? 0} titik`], // FIX
      ['Connector SC/APC', `${eq.connector?.count ?? 0} unit`], // FIX
      ['ONT/CPE', `${eq.ont?.count ?? 0} unit`], // FIX
    ]; // FIX
    eqRows.forEach(([label, value]) => {
      ry = kvRow(label, value, ry, rx, colW); // FIX
    }); // FIX

    ry += 6; // FIX
    ry = sectionTitle('Rincian Kabel', ry); // FIX
    ry = kvRow(
      'Feeder (OLT-ODC)',
      `${cab.breakdown?.feederM ?? 0} m — ${cab.feederCableType ?? ''}`,
      ry,
      rx,
      colW,
    ); // FIX
    ry = kvRow('Distribusi (ODC-ODP)', `${cab.breakdown?.distributionM ?? 0} m`, ry, rx, colW); // FIX
    ry = kvRow('Drop (ODP-ONT)', `${cab.breakdown?.dropM ?? 0} m`, ry, rx, colW); // FIX
    ry = kvRow('Buffer 15%', 'sudah termasuk', ry, rx, colW); // FIX
    ry = kvRow('TOTAL', `${((cab.totalM || 0) / 1000).toFixed(2)} km`, ry, rx, colW); // FIX

    // FIX: ─── PAGE 3: ROI 3 TIER ───────────────────────
    if (calcResult.roi?.tiers) {
      doc.addPage(); // FIX
      pageNum++; // FIX
      drawHeader('Estimasi ROI — 3 Segmen Pasar', pageNum); // FIX

      y = 20; // FIX
      const roi = calcResult.roi; // FIX
      const tiers = roi.tiers || []; // FIX

      doc.setFillColor(255, 251, 235); // FIX
      doc.setDrawColor(253, 230, 138); // FIX
      doc.rect(M, y, CW, 14, 'FD'); // FIX: Overall summary box
      doc.setFont('helvetica', 'bold'); // FIX
      doc.setFontSize(10); // FIX
      doc.setTextColor(146, 64, 14); // FIX
      doc.text(
        `Total Revenue/bulan: Rp ${((roi.totalMonthlyRevenue || 0) / 1e6).toFixed(1)}M  |  ` +
          `Overall BEP: ${roi.overallBepMonths || 0} bulan (${roi.overallBepYears || 0} tahun)  |  ` +
          `Take Rate Total: ${roi.totalTakeRatePct || 0}%`,
        W / 2,
        y + 9,
        { align: 'center' },
      ); // FIX
      y += 18; // FIX

      const tierW = (CW - 10) / 3; // FIX
      const TIER_COLORS: Record<string, [number, number, number]> = {
        Basic: [59, 130, 246], // FIX
        Standard: [0, 212, 180], // FIX
        Premium: [139, 92, 246], // FIX
      }; // FIX

      tiers.forEach((tier: any, i: number) => {
        const tx = M + i * (tierW + 5); // FIX
        const tc = TIER_COLORS[tier.name] || ACCENT; // FIX
        const tHeight = 80; // FIX

        doc.setDrawColor(tc[0], tc[1], tc[2]); // FIX
        doc.setLineWidth(0.8); // FIX
        doc.rect(tx, y, tierW, tHeight); // FIX

        doc.setFillColor(tc[0], tc[1], tc[2]); // FIX
        doc.rect(tx, y, tierW, 12, 'F'); // FIX
        doc.setFont('helvetica', 'bold'); // FIX
        doc.setFontSize(11); // FIX
        doc.setTextColor(255, 255, 255); // FIX
        doc.text(tier.name, tx + tierW / 2, y + 8, { align: 'center' }); // FIX

        const viableText = tier.isViable ? 'Viable' : 'Review'; // FIX: ASCII for jsPDF
        doc.setFontSize(7); // FIX
        doc.setFont('helvetica', 'normal'); // FIX
        doc.text(viableText, tx + tierW - 2, y + 8, { align: 'right' }); // FIX

        doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
        let ty = y + 18; // FIX
        const addMetric = (label: string, value: string, highlight = false) => {
          doc.setFont('helvetica', highlight ? 'bold' : 'normal'); // FIX
          doc.setFontSize(8); // FIX
          doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
          doc.text(label, tx + 3, ty); // FIX
          doc.setFont('helvetica', 'bold'); // FIX
          if (highlight) {
            doc.setTextColor(tc[0], tc[1], tc[2]); // FIX
          } else {
            doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
          } // FIX
          doc.setFontSize(highlight ? 10 : 9); // FIX
          doc.text(value, tx + tierW - 3, ty, { align: 'right' }); // FIX
          ty += highlight ? 8 : 7; // FIX
          doc.setFontSize(8); // FIX
        }; // FIX

        addMetric('ARPU/bulan', `Rp ${(tier.arpu / 1000).toFixed(0)}k`); // FIX
        addMetric('Take Rate', `${tier.takeRatePct}%`); // FIX
        addMetric('Active Homepass', `${tier.activeHomepass} unit`); // FIX
        addMetric('Revenue/bulan', `Rp ${(tier.monthlyRevenue / 1e6).toFixed(1)}M`, true); // FIX
        const annRev = tier.annualRevenue ?? tier.monthlyRevenue * 12; // FIX
        addMetric('Revenue/tahun', `Rp ${(annRev / 1e6).toFixed(0)}M`); // FIX
        addMetric('BEP', `${tier.breakEvenMonths} bulan`, true); // FIX
      }); // FIX

      y += 90; // FIX

      y = sectionTitle('Ringkasan Investasi', y); // FIX
      const ce = calcResult.costEstimation || {}; // FIX
      y = kvRow('Total Material', `Rp ${((ce.totalMaterial || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow('Total Instalasi', `Rp ${((ce.totalInstall || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow('TOTAL PROYEK', `Rp ${((ce.totalProject || 0) / 1e6).toFixed(0)}M`, y); // FIX
      y = kvRow(
        'Cost per Homepass',
        `Rp ${(ce.costPerHomepass || 0).toLocaleString('id-ID')}`,
        y,
      ); // FIX
    } // FIX

    // FIX: ─── PAGE 4: RECOMMENDATIONS ─────────────────
    if (calcResult.recommendations?.length) {
      doc.addPage(); // FIX
      pageNum++; // FIX
      drawHeader('Rekomendasi Detail', pageNum); // FIX

      y = 20; // FIX
      const recs: any[] = calcResult.recommendations; // FIX

      recs.forEach((r: any) => {
        if (y > H - 30) {
          doc.addPage(); // FIX
          pageNum++; // FIX
          drawHeader('Rekomendasi Detail (lanjutan)', pageNum); // FIX
          y = 20; // FIX
        } // FIX

        const title = typeof r === 'string' ? r : r.title || ''; // FIX
        const detail = typeof r === 'string' ? '' : r.detail || ''; // FIX
        const sev = typeof r === 'string' ? 'info' : r.severity || 'info'; // FIX

        const sevColor: Record<string, [number, number, number]> = {
          success: [34, 197, 94], // FIX
          warning: [245, 158, 11], // FIX
          error: [239, 68, 68], // FIX
          info: [59, 130, 246], // FIX
        }; // FIX
        const sc = sevColor[sev] || sevColor.info; // FIX

        doc.setFillColor(sc[0], sc[1], sc[2]); // FIX
        doc.rect(M, y, 2, detail ? 14 : 8, 'F'); // FIX

        doc.setFont('helvetica', 'bold'); // FIX
        doc.setFontSize(9); // FIX
        doc.setTextColor(DARK[0], DARK[1], DARK[2]); // FIX
        const cleanTitle =
          title.replace(/[^\x00-\x7F]/g, '').trim() || // FIX
          title.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim(); // FIX: strip BMP-surrogate emoji without /u flag
        doc.text(cleanTitle || title, M + 5, y + 5.5); // FIX

        if (detail) {
          doc.setFont('helvetica', 'normal'); // FIX
          doc.setFontSize(8); // FIX
          doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]); // FIX
          const cleanDetail = detail.replace(/[^\x00-\x7F\s]/g, '').trim(); // FIX
          const lines = doc.splitTextToSize(cleanDetail || detail, CW - 8); // FIX
          const showLines = lines.slice(0, 2); // FIX
          doc.text(showLines, M + 5, y + 11); // FIX
          y += 18 + Math.max(0, (showLines.length - 1) * 4); // FIX
        } else {
          y += 12; // FIX
        } // FIX
      }); // FIX
    } // FIX
  } // FIX

  doc.save(`permatrax-ftth-${new Date().toISOString().slice(0, 10)}.pdf`); // FIX
} // FIX

/** FIX: UI state for export button disabled/spinner — colocated with export funcs per Phase 1 plan */
export function useExports() {
  const [exporting, setExporting] = useState(false); // FIX
  return { exporting, setExporting }; // FIX
}
