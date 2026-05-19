'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { apiPost } from '../lib/api';
import type { ParsedExcelRow } from '../types/api.types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: { created: number; skipped: number }) => void;
}

export function CleanListImportPanel({ isOpen, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [file, setFile] = useState<File | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<'MASTER' | 'POTENSIAL_CBN'>('MASTER');
  const [parsedRows, setParsedRows] = useState<ParsedExcelRow[]>([]);
  const [ispCustomer, setIspCustomer] = useState('FiberStar');
  const [fiberType, setFiberType] = useState<'FTTH' | 'FTTB' | 'FTTT'>('FTTH');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const summary = useMemo(() => ({
    total: parsedRows.length,
    cities: new Set(parsedRows.map((r) => r.kotaKabupaten)).size,
    totalHp: parsedRows.reduce((acc, cur) => acc + (cur.homepasCount || 0), 0),
  }), [parsedRows]);

  if (!isOpen) return null;

  const parseFile = async () => {
    if (!file) return;
    setIsProcessing(true);
    setParseError(null);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = selectedSheet === 'MASTER' ? parseMasterSheet(wb) : parsePotensialCBNSheet(wb);
      setParsedRows(rows);
      setStep(2);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Gagal parse file');
    } finally {
      setIsProcessing(false);
    }
  };

  const submitImport = async () => {
    setIsProcessing(true);
    try {
      const res = await apiPost<{ created: number; skipped: number; errors: string[] }>('/clean-list/import-excel', {
        rows: parsedRows,
        ispCustomer,
        fiberType,
      });
      setResult(res);
      setStep(4);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-[520px] bg-white z-50 p-4 overflow-y-auto">
        <div className="flex justify-between items-center mb-4"><h2 className="font-bold">Import Clean List</h2><button onClick={onClose}>x</button></div>
        {step === 1 && (
          <div className="space-y-3">
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <select value={selectedSheet} onChange={(e) => setSelectedSheet(e.target.value as any)} className="border p-2 w-full">
              <option value="MASTER">MASTER</option>
              <option value="POTENSIAL_CBN">POTENSIAL CBN</option>
            </select>
            <input className="border p-2 w-full" value={ispCustomer} onChange={(e) => setIspCustomer(e.target.value)} />
            <div className="flex gap-2">{(['FTTH', 'FTTB', 'FTTT'] as const).map((f) => <button key={f} className={`px-3 py-2 border ${fiberType === f ? 'bg-teal-100' : ''}`} onClick={() => setFiberType(f)}>{f}</button>)}</div>
            {parseError && <div className="text-red-600 text-sm">{parseError}</div>}
            <button disabled={!file || isProcessing} className="px-3 py-2 bg-teal-500 text-white rounded" onClick={parseFile}>Parse File</button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <div>{summary.total} baris, {summary.cities} kota, HP {summary.totalHp}</div>
            <div className="max-h-64 overflow-auto border rounded">
              {parsedRows.slice(0, 10).map((r, i) => <div className="p-2 border-b" key={i}>{r.siteName} - {r.kotaKabupaten}</div>)}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-3 py-2 border rounded">Kembali</button>
              <button onClick={() => setStep(3)} className="px-3 py-2 bg-teal-500 text-white rounded">Lanjut</button>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <div className="border p-3 rounded">File: {file?.name}<br />Sheet: {selectedSheet}<br />ISP: {ispCustomer}<br />Fiber: {fiberType}<br />Total: {parsedRows.length}</div>
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="px-3 py-2 border rounded">Kembali</button>
              <button onClick={submitImport} disabled={isProcessing} className="px-3 py-2 bg-teal-500 text-white rounded">Import</button>
            </div>
          </div>
        )}
        {step === 4 && result && (
          <div className="space-y-3">
            <div>{result.created} data baru, {result.skipped} diperbarui</div>
            <button className="px-3 py-2 bg-teal-500 text-white rounded" onClick={() => { onSuccess({ created: result.created, skipped: result.skipped }); onClose(); }}>Tutup & Refresh</button>
          </div>
        )}
      </div>
    </>
  );
}

function parseMasterSheet(workbook: XLSX.WorkBook): ParsedExcelRow[] {
  const sheet = workbook.Sheets.MASTER;
  if (!sheet) throw new Error('Sheet MASTER tidak ditemukan');
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: false });
  const header = raw[2] as string[];
  const rows = raw.slice(3);
  const idx = (k: string) => header.indexOf(k);
  return rows
    .filter((r) => r[idx('Site Name')] && r[idx('City')])
    .map((r) => ({
      siteName: String(r[idx('Site Name')]).trim(),
      kotaKabupaten: String(r[idx('City')]).trim(),
      kelurahan: String(r[idx('Site Name')]).trim(),
      homepasCount: parseInt(String(r[idx('HP Plan')] || 0), 10) || 0,
      actualHP: parseInt(String(r[idx('Actual HP')] || 0), 10) || undefined,
      permitStatus: String(r[idx('Permit Status')] || '').trim() || undefined,
      implStatus: String(r[idx('Implementation Status')] || '').trim() || undefined,
      picPermit: String(r[idx('PIC Permit')] || '').trim() || undefined,
      projectType: String(r[idx('Project Type')] || '').trim() || undefined,
      sourceSheet: 'MASTER',
    }));
}

function parsePotensialCBNSheet(workbook: XLSX.WorkBook): ParsedExcelRow[] {
  const sheet = workbook.Sheets['POTENSIAL CBN'];
  if (!sheet) throw new Error('Sheet POTENSIAL CBN tidak ditemukan');
  const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: false });
  return raw.slice(1).filter((r) => r?.[1] && r?.[9]).map((row) => ({
    siteName: String(row[1]).trim(),
    kotaKabupaten: String(row[9]).trim(),
    kecamatan: String(row[10] || '').trim(),
    kelurahan: String(row[11] || '').trim(),
    rwCode: String(row[4] || '').trim() || undefined,
    externalCode: String(row[4] || '').trim() || undefined,
    homepasCount: parseInt(String(row[14] || 0), 10) || 0,
    coordinates: String(row[12] || '').trim() || undefined,
    hasExistingFiber: String(row[13] || '').toLowerCase() === 'covered',
    projectType: 'POTENSIAL CBN',
    sourceSheet: 'POTENSIAL_CBN',
  }));
}
