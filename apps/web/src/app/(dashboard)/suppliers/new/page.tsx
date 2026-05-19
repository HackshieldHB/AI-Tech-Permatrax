'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { apiPost } from '../../../../lib/api';
import { toast } from 'sonner';
import type { Supplier } from '../../../../types/api.types';

const FormSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  npwp: z.string().optional(),
  email: z.string().email('Email tidak valid').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  bankAccount: z.string().optional(),
  bankName: z.string().optional(),
  contactPerson: z.string().optional(),
  notes: z.string().optional(),
});

export default function NewSupplierPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
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
    setSubmitting(true);
    try {
      const body = {
        name: parsed.data.name,
        npwp: parsed.data.npwp,
        email: parsed.data.email && parsed.data.email.length > 0 ? parsed.data.email : undefined,
        phone: parsed.data.phone || undefined,
        address: parsed.data.address || undefined,
        bankAccount: parsed.data.bankAccount || undefined,
        bankName: parsed.data.bankName || undefined,
        contactPerson: parsed.data.contactPerson || undefined,
        notes: parsed.data.notes || undefined,
      };
      const created = await apiPost<Supplier>('/suppliers', body);
      toast.success('Supplier dibuat');
      router.replace(`/suppliers/${created.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
      <Link href="/suppliers" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#0969DA', marginBottom: 16 }}>
        <ArrowLeft size={16} /> Kembali
      </Link>
      <h1 style={{ margin: '0 0 20px', fontSize: 22 }}>Supplier baru</h1>
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
          disabled={submitting}
          style={{
            marginTop: 8,
            padding: '12px 16px',
            borderRadius: 8,
            border: 'none',
            fontWeight: 600,
            background: submitting ? '#8C959F' : '#00D4B4',
            color: '#0D1117',
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </button>
      </form>
    </div>
  );
}
