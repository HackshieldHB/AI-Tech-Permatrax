'use client'; // FIX: edit rejected cash operation then re-submit approval

import { useState, useEffect, useCallback } from 'react'; // FIX
import { useParams, useRouter } from 'next/navigation'; // FIX
import { useAuthStore } from '../../../../../store/authStore'; // FIX: five levels up to src/
import { apiGet, apiPatch, apiPost, uploadFile, fixFileUrl } from '../../../../../lib/api'; // FIX
import { toast } from 'sonner'; // FIX
import { ArrowLeft, PlusCircle, Trash2, Send } from 'lucide-react'; // FIX

interface LineItem {
  // FIX
  no: number; // FIX
  item: string; // FIX
  date: string; // FIX
  nominal: number; // FIX
} // FIX

function formatRp(n: number): string {
  // FIX
  return `Rp ${n.toLocaleString('id-ID')}`; // FIX
} // FIX

function parseNominal(v: string): number {
  // FIX
  return Number(v.replace(/[^0-9]/g, '')) || 0; // FIX
} // FIX

export default function EditCashOperationPage() {
  // FIX
  const { id } = useParams<{ id: string }>(); // FIX
  const router = useRouter(); // FIX
  const { user } = useAuthStore(); // FIX

  const [req, setReq] = useState<any>(null); // FIX
  const [loading, setLoading] = useState(true); // FIX
  const [saving, setSaving] = useState(false); // FIX

  const [title, setTitle] = useState(''); // FIX
  const [notes, setNotes] = useState(''); // FIX
  const [lineItems, setLineItems] = useState<LineItem[]>([{ no: 1, item: '', date: '', nominal: 0 }]); // FIX
  const [caAmountInput, setCaAmountInput] = useState('');
  const [periodeFrom, setPeriodeFrom] = useState('');
  const [periodeTo, setPeriodeTo] = useState('');
  const [nomorRekeningPengaju, setNomorRekeningPengaju] = useState('');
  const [photos, setPhotos] = useState<string[]>([]); // FIX
  const [photoNames, setPhotoNames] = useState<string[]>([]); // FIX
  const [uploading, setUploading] = useState(false); // FIX

  useEffect(() => {
    // FIX
    const load = async () => {
      // FIX
      try {
        // FIX
        const data = await apiGet<any>(`/cash-operation/${id}`); // FIX
        setReq(data); // FIX
        setTitle(data.description?.split('\n')[0] || ''); // FIX
        const notesMatch = data.description?.match(/\n\nCatatan: ([\s\S]+)/); // FIX: avoid /s flag for ES2017 target
        setNotes(notesMatch?.[1] || ''); // FIX
        if (data.type === 'CASH_ADVANCE') {
          setCaAmountInput(data.amount ? String(data.amount) : '');
          if (data.periodeFrom) setPeriodeFrom(new Date(data.periodeFrom).toISOString().split('T')[0]);
          if (data.periodeTo) setPeriodeTo(new Date(data.periodeTo).toISOString().split('T')[0]);
          setNomorRekeningPengaju(data.nomorRekeningPengaju || '');
        } else {
          if (data.lineItems && Array.isArray(data.lineItems)) {
            // FIX
            setLineItems(
              data.lineItems.length > 0 ? data.lineItems : [{ no: 1, item: '', date: '', nominal: 0 }],
            ); // FIX
          } // FIX
        }
        const urls: string[] = Array.isArray(data.photoUrls) // FIX
          ? data.photoUrls.map((u: unknown) => String(u)) // FIX
          : (data.attachments || []).map((a: { fileUrl?: string }) => a.fileUrl).filter(Boolean); // FIX
        if (urls.length) {
          // FIX
          setPhotos(urls); // FIX
          setPhotoNames(urls.map((_, i) => `Foto ${i + 1}`)); // FIX
        } // FIX
      } catch {
        // FIX
        toast.error('Gagal memuat data'); // FIX
      } finally {
        // FIX
        setLoading(false); // FIX
      } // FIX
    }; // FIX
    void load(); // FIX
  }, [id]); // FIX

  useEffect(() => {
    // FIX: redirect non-owners or wrong status after load
    if (!loading && req && (req.status !== 'REJECTED' || req.requestedBy !== user?.id)) {
      // FIX
      router.replace('/cash-operation'); // FIX
    } // FIX
  }, [loading, req, user?.id, router]); // FIX

  const total = req?.type === 'CASH_ADVANCE' ? parseNominal(caAmountInput) : lineItems.reduce((s, l) => s + (l.nominal || 0), 0); // FIX

  const addLine = () =>
    setLineItems((prev) => [...prev, { no: prev.length + 1, item: '', date: '', nominal: 0 }]); // FIX

  const removeLine = (idx: number) => {
    // FIX
    if (lineItems.length === 1) return; // FIX
    setLineItems((prev) =>
      prev
        .filter((_, i) => i !== idx) // FIX
        .map((it, i) => ({ ...it, no: i + 1 })),
    ); // FIX
  }; // FIX

  const updateLine = useCallback((idx: number, field: keyof LineItem, value: string | number) => {
    // FIX
    setLineItems((prev) =>
      prev.map((it, i) =>
        i === idx
          ? {
              ...it,
              [field]: field === 'nominal' ? parseNominal(String(value)) : value,
            } // FIX
          : it,
      ),
    ); // FIX
  }, []); // FIX

  const handlePhotoUpload = async (files: FileList | null) => {
    // FIX
    if (!files) return; // FIX
    setUploading(true); // FIX
    try {
      // FIX
      for (const file of Array.from(files)) {
        // FIX
        if (file.size > 10 * 1024 * 1024) {
          // FIX
          toast.error(`${file.name} terlalu besar`); // FIX
          continue; // FIX
        } // FIX
        const url = await uploadFile(file, 'cash-operation/photos', 'general'); // FIX
        setPhotos((p) => [...p, url]); // FIX
        setPhotoNames((p) => [...p, file.name]); // FIX
        toast.success(`✅ ${file.name} diupload`); // FIX
      } // FIX
    } catch (err: unknown) {
      // FIX
      toast.error(`Upload gagal: ${err instanceof Error ? err.message : 'error'}`); // FIX
    } finally {
      // FIX
      setUploading(false); // FIX
    } // FIX
  }; // FIX

  const handleSubmit = async () => {
    // FIX
    if (!title.trim()) {
      // FIX
      toast.error('Judul wajib diisi'); // FIX
      return; // FIX
    } // FIX
    if (total === 0) {
      // FIX
      toast.error('Minimal 1 item dengan nominal'); // FIX
      return; // FIX
    } // FIX
    if (req?.type === 'REIMBURSEMENT' && photos.length === 0) {
      // FIX
      toast.error('Upload foto bukti untuk reimbursement'); // FIX
      return; // FIX
    } // FIX

    setSaving(true); // FIX
    try {
      // FIX
      await apiPatch(`/cash-operation/${id}`, {
        // FIX
        title, // FIX
        description: title, // FIX
        notes, // FIX
        ...(req?.type === 'CASH_ADVANCE' ? {
          totalAmount: total,
          amount: total,
          periodeFrom,
          periodeTo,
          nomorRekeningPengaju: nomorRekeningPengaju.trim(),
        } : {
          lineItems: lineItems.filter((l) => l.item.trim()), // FIX
          totalAmount: total, // FIX
          amount: total, // FIX
        }),
        photoUrls: photos, // FIX
      }); // FIX
      await apiPost(`/cash-operation/${id}/submit`, {}); // FIX
      toast.success('✅ Pengajuan berhasil diperbarui dan disubmit ulang'); // FIX
      router.push('/cash-operation'); // FIX
    } catch (err: unknown) {
      // FIX
      toast.error(err instanceof Error ? err.message : 'Gagal submit'); // FIX
    } finally {
      // FIX
      setSaving(false); // FIX
    } // FIX
  }; // FIX

  const inputStyle = {
    // FIX
    width: '100%', // FIX
    boxSizing: 'border-box' as const, // FIX
    padding: '9px 12px', // FIX
    borderRadius: 8, // FIX
    fontSize: 13, // FIX
    border: '1.5px solid var(--color-border-tertiary)', // FIX
    background: 'var(--color-background-primary)', // FIX
    color: 'var(--color-text-primary)', // FIX
    outline: 'none', // FIX
  }; // FIX

  if (loading) {
    // FIX
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>⏳ Memuat...</div>
    ); // FIX
  } // FIX

  if (!req) {
    // FIX
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>
        Request tidak ditemukan
      </div>
    ); // FIX
  } // FIX

  if (req.status !== 'REJECTED' || req.requestedBy !== user?.id) {
    // FIX
    return null; // FIX
  } // FIX

  const accentColor = req.type === 'REIMBURSEMENT' ? '#3B82F6' : '#00D4B4'; // FIX

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', paddingBottom: 60 }}>
      <button
        type="button"
        onClick={() => router.back()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 8,
          marginBottom: 20,
          border: '0.5px solid var(--color-border-tertiary)',
          background: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--color-text-secondary)',
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Kembali
      </button>

      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 20px',
            borderRadius: 14,
            background: '#EF444410',
            border: '1px solid #EF444430',
          }}
        >
          <span style={{ fontSize: 28 }}>✏️</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              Edit Pengajuan {req.type === 'REIMBURSEMENT' ? 'Reimbursement' : 'Cash Advance'}
            </div>
            <div style={{ fontSize: 12, color: '#EF4444', marginTop: 2 }}>Ditolak — perbaiki dan submit ulang</div>
          </div>
        </div>
      </div>

      {req.rejectionReason ? (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 10,
            marginBottom: 16,
            background: '#EF444412',
            border: '0.5px solid #EF444430',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', marginBottom: 4 }}>Alasan Penolakan:</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>{req.rejectionReason}</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            📝 Informasi Pengajuan
          </div>
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  marginBottom: 5,
                  color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Judul *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Judul pengajuan..."
                style={inputStyle}
              />
            </div>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 600,
                  marginBottom: 5,
                  color: 'var(--color-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Catatan
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Catatan..."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>
          </div>
        </div>

        {req.type === 'CASH_ADVANCE' ? (
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '0.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-secondary)',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            >
              💰 Nominal & Periode
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                  }}
                >
                  Nominal Cash Advance *
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: 9, fontSize: 13, fontWeight: 700, color: 'var(--color-text-secondary)' }}>Rp</span>
                  <input
                    type="text"
                    value={caAmountInput ? Number(caAmountInput).toLocaleString('id-ID') : ''}
                    onChange={(e) => setCaAmountInput(String(parseNominal(e.target.value)))}
                    placeholder="0"
                    style={{ ...inputStyle, paddingLeft: 40, fontSize: 16, fontWeight: 700 }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 5,
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Mulai Periode *
                  </label>
                  <input
                    type="date"
                    value={periodeFrom}
                    onChange={(e) => setPeriodeFrom(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11,
                      fontWeight: 600,
                      marginBottom: 5,
                      color: 'var(--color-text-secondary)',
                      textTransform: 'uppercase',
                    }}
                  >
                    Selesai Periode *
                  </label>
                  <input
                    type="date"
                    value={periodeTo}
                    onChange={(e) => setPeriodeTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    marginBottom: 5,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                  }}
                >
                  Nomor Rekening Pengaju
                </label>
                <input
                  type="text"
                  value={nomorRekeningPengaju}
                  onChange={(e) => setNomorRekeningPengaju(e.target.value)}
                  placeholder="Contoh: 1234567890 (BCA a/n Nama)"
                  style={inputStyle}
                />
                <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                  Digunakan untuk pengembalian dana jika terdapat kelebihan penggunaan Cash Advance.
                </p>
              </div>
            </div>
          </div>
        ) : (
        <div
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>📋 Rincian Dana</span>
            <button
              type="button"
              onClick={addLine}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 6,
                border: 'none',
                background: `${accentColor}15`,
                color: accentColor,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <PlusCircle style={{ width: 12, height: 12 }} />
              Tambah
            </button>
          </div>
          <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14 }}>
              <thead>
                <tr>
                  {['No', 'Item', 'Tanggal', 'Nominal', ''].map((h, i) => (
                    <th
                      key={h}
                      style={{
                        padding: '8px 10px',
                        textAlign: i === 3 ? 'right' : 'left',
                        fontSize: 10,
                        fontWeight: 700,
                        color: 'var(--color-text-secondary)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: '2px solid var(--color-border-tertiary)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((line, idx) => (
                  <tr key={idx} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                    <td
                      style={{
                        padding: '8px 10px',
                        width: 36,
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {line.no}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input
                        type="text"
                        value={line.item}
                        onChange={(e) => updateLine(idx, 'item', e.target.value)}
                        placeholder="Item..."
                        style={{ ...inputStyle, minWidth: 180 }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input
                        type="date"
                        value={line.date}
                        onChange={(e) => updateLine(idx, 'date', e.target.value)}
                        style={{ ...inputStyle, width: 140 }}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <input
                        type="text"
                        value={line.nominal ? line.nominal.toLocaleString('id-ID') : ''}
                        onChange={(e) => updateLine(idx, 'nominal', e.target.value)}
                        placeholder="0"
                        style={{ ...inputStyle, width: 150, textAlign: 'right' }}
                      />
                    </td>
                    <td style={{ padding: '8px 6px', width: 32 }}>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lineItems.length === 1}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: lineItems.length === 1 ? 'none' : '#EF444415',
                          border: 'none',
                          cursor: lineItems.length === 1 ? 'not-allowed' : 'pointer',
                          color: lineItems.length === 1 ? 'var(--color-border-tertiary)' : '#EF4444',
                        }}
                      >
                        <Trash2 style={{ width: 12, height: 12 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${accentColor}30`, background: `${accentColor}08` }}>
                  <td colSpan={2} style={{ padding: '12px 10px' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text-primary)' }}>TOTAL</span>
                  </td>
                  <td />
                  <td style={{ padding: '12px 10px', textAlign: 'right' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: accentColor }}>{formatRp(total)}</span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        )}

        <div
          style={{
            background: 'var(--color-background-primary)',
            border:
              req.type === 'REIMBURSEMENT' && photos.length === 0
                ? '1.5px solid #EF444440'
                : '0.5px solid var(--color-border-tertiary)',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              background: 'var(--color-background-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>📷 Foto Bukti</span>
            <span
              style={{
                padding: '3px 8px',
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                background: req.type === 'REIMBURSEMENT' ? '#EF444415' : '#8B5CF615',
                color: req.type === 'REIMBURSEMENT' ? '#EF4444' : '#8B5CF6',
              }}
            >
              {req.type === 'REIMBURSEMENT' ? '⚠ WAJIB' : 'OPSIONAL'}
            </span>
          </div>
          <div style={{ padding: 20 }}>
            {photos.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {photos.map((url, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img
                      src={fixFileUrl(url)}
                      alt={photoNames[i]}
                      style={{
                        width: '100%',
                        aspectRatio: '1',
                        objectFit: 'cover',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: '1px solid var(--color-border-tertiary)',
                      }}
                      onClick={() => window.open(fixFileUrl(url), '_blank')}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setPhotos((p) => p.filter((_, j) => j !== i));
                        setPhotoNames((p) => p.filter((_, j) => j !== i));
                      }}
                      style={{
                        position: 'absolute',
                        top: 3,
                        right: 3,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: '#EF4444',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 18px',
                borderRadius: 10,
                cursor: uploading ? 'wait' : 'pointer',
                border: `2px dashed ${uploading ? accentColor : 'var(--color-border-tertiary)'}`,
                background: 'var(--color-background-secondary)',
                transition: 'all 150ms',
              }}
            >
              <span style={{ fontSize: 24 }}>{uploading ? '⏳' : '📷'}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  {uploading ? 'Mengupload...' : '+ Tambah foto'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>JPG, PNG — Max 10MB</div>
              </div>
              <input
                type="file"
                multiple
                accept="image/*"
                disabled={uploading}
                style={{ display: 'none' }}
                onChange={(e) => {
                  void handlePhotoUpload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
          <button
            type="button"
            onClick={() => router.back()}
            disabled={saving}
            style={{
              padding: '12px 24px',
              borderRadius: 12,
              border: '1.5px solid var(--color-border-tertiary)',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
            }}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={
              saving ||
              !title.trim() ||
              total === 0 ||
              (req.type === 'REIMBURSEMENT' && photos.length === 0)
            }
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '12px 24px',
              borderRadius: 12,
              border: 'none',
              background:
                saving || !title.trim() || total === 0 || (req.type === 'REIMBURSEMENT' && photos.length === 0)
                  ? 'var(--color-background-secondary)'
                  : `linear-gradient(135deg, ${accentColor}, ${req.type === 'REIMBURSEMENT' ? '#2563EB' : '#00B89E'})`,
              color:
                saving || !title.trim() || total === 0 || (req.type === 'REIMBURSEMENT' && photos.length === 0)
                  ? 'var(--color-text-secondary)'
                  : 'white',
              cursor:
                saving || !title.trim() || total === 0 || (req.type === 'REIMBURSEMENT' && photos.length === 0)
                  ? 'not-allowed'
                  : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              boxShadow:
                saving || !title.trim() || total === 0 || (req.type === 'REIMBURSEMENT' && photos.length === 0)
                  ? 'none'
                  : `0 6px 20px ${accentColor}50`,
            }}
          >
            <Send style={{ width: 16, height: 16 }} />
            {saving ? 'Memproses...' : '🔄 Simpan & Submit Ulang'}
          </button>
        </div>
      </div>
    </div>
  );
}
