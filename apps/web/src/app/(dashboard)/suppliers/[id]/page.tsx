'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { apiGet, apiPatch } from '../../../../lib/api';
import { toast } from 'sonner';
import type { Supplier } from '../../../../types/api.types';

const FormSchema = z.object({
  name: z.string().min(1, 'Nama wajib').max(200),
  npwp: z.string().optional(),
  email: z.string().email('Email tidak valid').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  bankAccount: z.string().optional(),
  bankName: z.string().optional(),
  contactPerson: z.string().optional(),
  notes: z.string().optional(),
});

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [row, setRow] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    npwp: '',
    email: '',
    phone: '',
    address: '',
    bankAccount: '',
    bankName: '',
    contactPerson: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiGet<Supplier>(`/suppliers/${id}`);
      setRow(s);
      setForm({
        name: s.name,
        npwp: s.npwp ?? '',
        email: s.email ?? '',
        phone: s.phone ?? '',
        address: s.address ?? '',
        bankAccount: s.bankAccount ?? '',
        bankName: s.bankName ?? '',
        contactPerson: s.contactPerson ?? '',
        notes: s.notes ?? '',
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      ...form,
      email: form.email.trim() || undefined,
      npwp: form.npwp.trim() || undefined,
    });
    if (parsed.success === false) {
      toast.error(parsed.error.errors[0]?.message ?? 'Data tidak valid');
      return;
    }
    setSaving(true);
    try {
      await apiPatch<Supplier>(`/suppliers/${id}`, {
        name: parsed.data.name,
        npwp: parsed.data.npwp,
        email: parsed.data.email && parsed.data.email.length > 0 ? parsed.data.email : undefined,
        phone: parsed.data.phone || undefined,
        address: parsed.data.address || undefined,
        bankAccount: parsed.data.bankAccount || undefined,
        bankName: parsed.data.bankName || undefined,
        contactPerson: parsed.data.contactPerson || undefined,
        notes: parsed.data.notes || undefined,
      });
      toast.success('Perubahan disimpan');
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !row) {
    return <div style={{ padding: 24 }}>Memuat…</div>;
  }
  if (!row) return <div style={{ padding: 24 }}>Supplier tidak ditemukan.</div>;

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <Link href="/suppliers" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Daftar supplier
      </Link>
      <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{row.code}</h1>
      <p style={{ margin: '0 0 20px', color: '#57606a', fontSize: 14 }}>Status: {row.isActive ? 'Aktif' : 'Nonaktif'}</p>

      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, background: '#fff', padding: 20, borderRadius: 12, border: '1px solid #D0D7DE' }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          <span>Nama *</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
          />
        </label>
        {(['npwp', 'email', 'phone', 'contactPerson', 'bankName', 'bankAccount', 'address', 'notes'] as const).map((k) => (
          <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span>{k === 'npwp' ? 'NPWP' : k === 'contactPerson' ? 'Contact person' : k}</span>
            {k === 'address' || k === 'notes' ? (
              <textarea
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                rows={k === 'notes' ? 3 : 2}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE', fontFamily: 'inherit' }}
              />
            ) : (
              <input
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                style={{ padding: 10, borderRadius: 8, border: '1px solid #D0D7DE' }}
              />
            )}
          </label>
        ))}
        <button
          type="submit"
          disabled={saving}
          style={{
            marginTop: 8,
            padding: '12px 16px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            background: saving ? '#8C959F' : '#00D4B4',
            color: '#0D1117',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Menyimpan…' : 'Simpan perubahan'}
        </button>
      </form>
    </div>
  );
}
