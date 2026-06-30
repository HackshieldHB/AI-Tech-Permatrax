'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '../../../../lib/auth';
import { useAuthStore } from '../../../../store/authStore';
import { FTTT_COMPANY_LABELS, FTTT_DOC_TYPE_LABELS } from '../../../../types/api.types';

type FtttCompany = 'TELKOM_INFRA' | 'IFORTE' | 'PST';
type FtttDocType  = 'PO_CONTRACT' | 'SITELIST' | 'BOQ_TOS';

// Which trigger doc type belongs to which company
const COMPANY_DOC_TYPES: Record<FtttCompany, FtttDocType> = {
  TELKOM_INFRA: 'PO_CONTRACT',
  IFORTE:       'SITELIST',
  PST:          'BOQ_TOS',
};

const COMPANY_DOC_HINTS: Record<FtttCompany, string> = {
  TELKOM_INFRA: 'Unggah file PO / Contract dalam format PDF',
  IFORTE:       'Unggah file Sitelist dalam format Excel (.xlsx / .xls)',
  PST:          'Unggah file BOQ & TOS dalam format Excel (.xlsx / .xls)',
};

const COMPANY_DOC_ACCEPT: Record<FtttCompany, string> = {
  TELKOM_INFRA: '.pdf',
  IFORTE:       '.xlsx,.xls',
  PST:          '.xlsx,.xls',
};

export default function NewFtttProjectPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Issue #5: Redirect non-PM_FTTT users — only PM_FTTT can create projects
  useEffect(() => {
    if (user && user.role !== 'PM_FTTT') {
      router.replace('/fttt-projects');
    }
  }, [user, router]);

  const [company, setCompany] = useState<FtttCompany | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // JLM: Nama Project is now a dropdown of FTTT Finance Projects
  const [financeProjectId, setFinanceProjectId] = useState('');
  const [financeOptions, setFinanceOptions] = useState<{ id: string; code: string; name: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/fttt-projects/finance-options', { method: 'GET' }, user?.id);
        if (res.ok) setFinanceOptions(await res.json());
      } catch { /* ignore */ }
    })();
  }, [user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) { toast.error('Pilih perusahaan terlebih dahulu'); return; }
    if (!file)    { toast.error('Unggah dokumen triggering terlebih dahulu'); return; }

    const formData = new FormData();
    formData.append('triggerDoc', file);
    formData.append('data', JSON.stringify({
      ftttCompany:    company,
      triggerDocType: COMPANY_DOC_TYPES[company],
      financeProjectId: financeProjectId || undefined,
      notes:          notes.trim() || undefined,
    }));

    setSubmitting(true);
    try {
      const res = await apiFetch('/fttt-projects', { method: 'POST', body: formData }, user?.id);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Gagal membuat project' }));
        throw new Error(err.message);
      }
      const created = await res.json() as { id: string };
      toast.success('Project FTTT berhasil dibuat');
      router.replace(`/fttt-projects/${created.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 680, margin: '0 auto' }}>
      <Link href="/fttt-projects" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16, textDecoration: 'none' }}>
        <ArrowLeft size={16} /> Daftar FTTT Projects
      </Link>
      <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Project Initiation — FTTT</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: '#57606a' }}>
        Pilih perusahaan klien dan unggah dokumen triggering untuk memulai lifecycle project.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Company selection */}
        <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20 }}>
          <p style={{ margin: '0 0 12px', fontWeight: 600, fontSize: 14 }}>
            Perusahaan Klien <span style={{ color: '#CF222E' }}>*</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(['TELKOM_INFRA', 'IFORTE', 'PST'] as FtttCompany[]).map((c) => (
              <label
                key={c}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12,
                  borderRadius: 8,
                  border: `2px solid ${company === c ? '#0969DA' : '#D0D7DE'}`,
                  background: company === c ? '#F0F8FF' : '#fff',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <input
                  type="radio"
                  name="company"
                  value={c}
                  checked={company === c}
                  onChange={() => { setCompany(c); setFile(null); }}
                  style={{ accentColor: '#0969DA' }}
                />
                <div>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{FTTT_COMPANY_LABELS[c]}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#57606a' }}>{COMPANY_DOC_HINTS[c]}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Trigger document upload — only shown after company selected */}
        {company ? (
          <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20 }}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14 }}>
              Dokumen Triggering — {FTTT_DOC_TYPE_LABELS[COMPANY_DOC_TYPES[company]]} <span style={{ color: '#CF222E' }}>*</span>
            </p>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#57606a' }}>{COMPANY_DOC_HINTS[company]}</p>

            <input
              ref={fileInputRef}
              type="file"
              accept={COMPANY_DOC_ACCEPT[company]}
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />

            {file ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#F0F8FF', borderRadius: 8, border: '1px solid #0969DA' }}>
                <FileText size={20} color="#0969DA" />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{file.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#57606a' }}>{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #D0D7DE', cursor: 'pointer', background: '#fff' }}
                >
                  Ganti
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%', padding: 16, borderRadius: 8, border: '2px dashed #D0D7DE',
                  background: '#F6F8FA', cursor: 'pointer', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6, color: '#57606a',
                }}
              >
                <Upload size={24} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Klik untuk pilih file</span>
                <span style={{ fontSize: 11 }}>{COMPANY_DOC_ACCEPT[company]} · Maks 50 MB</span>
              </button>
            )}
          </div>
        ) : null}

        {/* Optional fields */}
        <div style={{ background: '#fff', border: '1px solid #D0D7DE', borderRadius: 12, padding: 20 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, marginBottom: 14 }}>
            <span style={{ fontWeight: 600 }}>Nama Project (dari Finance Project)</span>
            <select
              value={financeProjectId}
              onChange={(e) => setFinanceProjectId(e.target.value)}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14, background: '#fff' }}
            >
              <option value="">— Pilih Finance Project (FTTT) —</option>
              {financeOptions.map((fp) => (
                <option key={fp.id} value={fp.id}>{fp.code} · {fp.name}</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: '#8c959f' }}>
              Hanya menampilkan project Finance bertipe FTTT yang masih aktif. Budget & monitoring mengikuti project ini.
              {financeOptions.length === 0 && ' (Belum ada — buat dulu di menu Finance Project.)'}
            </span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>Catatan (opsional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontSize: 14, resize: 'vertical' }}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting || !company || !file}
          style={{
            padding: '12px 16px', borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 15,
            background: submitting || !company || !file ? '#8C959F' : '#0969DA',
            color: '#fff', cursor: submitting || !company || !file ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Membuat project…' : 'Mulai Project & Assign Lifecycle'}
        </button>
      </form>
    </div>
  );
}
