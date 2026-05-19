'use client';

// FIX: full modern UI rewrite — dark theme, dedicated page, step indicator, next-step banner
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost } from '../../../../../lib/api';
import { toast } from 'sonner';
import {
  ArrowLeft, Save, Users, Phone, MapPin,
  ChevronRight, CheckCircle,
} from 'lucide-react';
import { isPmOrSurveyorRole } from '../../../../../lib/roles';

// FIX: dedicated shared steps used across all 5 survey pages for consistent indicator
const SURVEY_STEPS = ['BA Open', 'Kunjungan', 'Data Survey', 'Route', 'SIP', 'Dokumen'];

// FIX: stable memo-like input (no external memo wrapper needed — the component is declared at module scope)
function FormInput({
  label, value, onChange, placeholder,
  required = false, error = false, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: boolean;
  type?: string;
}) {
  const [focused, setFocused] = useState(false); // FIX: local focus state for accent border
  const borderColor = error ? '#EF4444' : focused ? '#00D4B4' : 'var(--color-border-tertiary)';
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: error ? '#EF4444' : 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
        {required ? <span style={{ color: '#EF4444' }}> *</span> : null}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 14,
          border: `1.5px solid ${borderColor}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          transition: 'border-color 150ms',
        }}
      />
      {error ? (
        <p style={{ fontSize: 11, color: '#EF4444', margin: '4px 0 0' }}>
          {label} wajib diisi
        </p>
      ) : null}
    </div>
  );
}

function FormTextarea({
  label, value, onChange, placeholder, rows = 3, hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  const [focused, setFocused] = useState(false); // FIX: local focus accent
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        rows={rows}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 14,
          border: `1.5px solid ${focused ? '#00D4B4' : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          resize: 'vertical',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
        }}
      />
      {hint ? (
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          💡 {hint}
        </p>
      ) : null}
    </div>
  );
}

// FIX: reusable step indicator — current passed from each page
function StepIndicator({ current }: { current: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--color-background-secondary)',
        borderRadius: 10,
        padding: '10px 16px',
        marginBottom: 24,
        overflowX: 'auto',
        gap: 0,
      }}
    >
      {SURVEY_STEPS.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                background: i < current ? '#00D4B4' : i === current ? '#00D4B420' : 'transparent',
                color: i < current ? 'white' : i === current ? '#00D4B4' : 'var(--color-text-secondary)',
                border: i === current
                  ? '1.5px solid #00D4B4'
                  : i < current
                    ? 'none'
                    : '1px solid var(--color-border-tertiary)',
              }}
            >
              {i < current ? '✓' : i + 1}
            </div>
            <span
              style={{
                fontSize: 11,
                whiteSpace: 'nowrap',
                fontWeight: i === current ? 600 : 400,
                color:
                  i === current ? 'var(--color-text-primary)'
                    : i < current ? '#00D4B4'
                      : 'var(--color-text-secondary)',
              }}
            >
              {step}
            </span>
          </div>
          {i < SURVEY_STEPS.length - 1 ? (
            <div
              style={{
                flex: 1,
                height: 1,
                margin: '0 6px',
                background: i < current ? '#00D4B4' : 'var(--color-border-tertiary)',
                minWidth: 8,
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export default function SiteVisitPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // FIX: post-save banner state
  const [errors, setErrors] = useState<Record<string, boolean>>({}); // FIX: per-field validation state

  const [form, setForm] = useState({
    rwName: '',
    rwPhone: '',
    rtName: '',
    rtPhone: '',
    pengelolaName: '',
    pengelolaPhone: '',
    stakeholderNotes: '',
  });

  // FIX: stable field setter factory — no new function reference per render
  const setField = useCallback(
    (key: string) => (value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiGet<any>(`/permit-clusters/${clusterId}`);
        setCluster(data);
        try {
          const survey = await apiGet<any>(`/permit-clusters/${clusterId}/survey`);
          if (survey) {
            setForm({
              rwName:           survey.rwName || '',
              rwPhone:          survey.rwPhone || '',
              rtName:           survey.rtName || '',
              rtPhone:          survey.rtPhone || '',
              pengelolaName:    survey.pengelolaName || '',
              pengelolaPhone:   survey.pengelolaPhone || '',
              stakeholderNotes: survey.stakeholderNotes || '',
            });
          }
        } catch {
          // no existing survey record
        }
      } catch {
        toast.error('Gagal memuat data cluster');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [clusterId]);

  const validate = (): boolean => {
    const next: Record<string, boolean> = {};
    if (!form.rwName.trim()) next.rwName = true;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error('Nama RW wajib diisi');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/survey/site-visit`, form);
      setSaved(true); // FIX: show next-step banner instead of immediate navigation
      toast.success('Data kunjungan berhasil disimpan');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan');
    } finally {
      setSaving(false);
    }
  };

  const canEdit = isPmOrSurveyorRole(user?.role);

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          color: 'var(--color-text-secondary)',
          fontSize: 14,
        }}
      >
        <div>⏳ Memuat data cluster...</div>
      </div>
    );
  }

  const cl = cluster?.visitRequest?.cleanList;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 0 60px' }}>
      {/* FIX: compact back button — separate from breadcrumb for mobile */}
      <button
        onClick={() => router.push(`/permit-clusters/${clusterId}`)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 14px',
          borderRadius: 8,
          border: '0.5px solid var(--color-border-tertiary)',
          background: 'none',
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          marginBottom: 20,
        }}
      >
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Kembali ke Pipeline
      </button>

      {/* FIX: breadcrumb + title + chips */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          <span
            onClick={() => router.push('/permit-clusters')}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            Pipeline
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span
            onClick={() => router.push(`/permit-clusters/${clusterId}`)}
            style={{ cursor: 'pointer', textDecoration: 'underline' }}
          >
            {cluster?.clusterCode}
          </span>
          <ChevronRight style={{ width: 12, height: 12 }} />
          <span style={{ color: 'var(--color-text-primary)' }}>Kunjungan Lapangan</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              Data Kunjungan Lapangan
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Phase 4 — Input data RT/RW dan pengelola cluster
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                fontSize: 12,
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              📍 {cluster?.clusterCode}
            </span>
            {cl?.ispCustomer ? (
              <span
                style={{
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  background: '#00D4B415',
                  color: '#00D4B4',
                  fontWeight: 500,
                  border: '0.5px solid #00D4B440',
                }}
              >
                {cl.ispCustomer}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <StepIndicator current={1} />

      {/* FIX: location info bar */}
      {cl ? (
        <div
          style={{
            display: 'flex',
            gap: 20,
            padding: '12px 18px',
            background: 'var(--color-background-secondary)',
            borderRadius: 10,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {[
            ['Kelurahan', cl.kelurahan],
            ['Kecamatan', cl.kecamatan],
            ['Kota/Kab', cl.kotaKabupaten],
            ['Target HP', cl.homepasCount ? `${cl.homepasCount} rumah` : null],
          ].map(([lbl, val]) =>
            val ? (
              <div key={lbl as string}>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--color-text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 2,
                  }}
                >
                  {lbl}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {val}
                </div>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* FIX: Section 1 — RW (teal accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #00D4B4',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#00D4B415',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Users style={{ width: 16, height: 16, color: '#00D4B4' }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Data Ketua RW
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Informasi kontak pengurus Rukun Warga
                </p>
              </div>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: '#EF444415',
                  color: '#EF4444',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                WAJIB
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 14,
              }}
            >
              <FormInput
                label="Nama Ketua RW"
                value={form.rwName}
                onChange={setField('rwName')}
                placeholder="Contoh: Pak Budi Santoso"
                required
                error={!!errors.rwName}
              />
              <FormInput
                label="Nomor HP RW"
                value={form.rwPhone}
                onChange={setField('rwPhone')}
                placeholder="08xxxxxxxxxx"
                type="tel"
              />
            </div>
          </div>

          {/* FIX: Section 2 — RT (blue accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #3B82F6',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#3B82F615',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MapPin style={{ width: 16, height: 16, color: '#3B82F6' }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Data Ketua RT
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Opsional — isi jika ada pertemuan dengan RT
                </p>
              </div>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'var(--color-background-secondary)',
                  color: 'var(--color-text-secondary)',
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                OPSIONAL
              </span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 14,
              }}
            >
              <FormInput
                label="Nama Ketua RT"
                value={form.rtName}
                onChange={setField('rtName')}
                placeholder="Contoh: Pak Agus Wijaya"
              />
              <FormInput
                label="Nomor HP RT"
                value={form.rtPhone}
                onChange={setField('rtPhone')}
                placeholder="08xxxxxxxxxx"
                type="tel"
              />
            </div>
          </div>

          {/* FIX: Section 3 — Pengelola (purple accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #8B5CF6',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#8B5CF615',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Phone style={{ width: 16, height: 16, color: '#8B5CF6' }} />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Pengelola / Manajemen Cluster
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Pengelola gedung, cluster, atau perumahan
                </p>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 14,
              }}
            >
              <FormInput
                label="Nama Pengelola"
                value={form.pengelolaName}
                onChange={setField('pengelolaName')}
                placeholder="Nama pengelola atau manajemen"
              />
              <FormInput
                label="Nomor HP Pengelola"
                value={form.pengelolaPhone}
                onChange={setField('pengelolaPhone')}
                placeholder="08xxxxxxxxxx"
                type="tel"
              />
            </div>
          </div>

          {/* FIX: Section 4 — Notes (amber accent) */}
          <div
            style={{
              background: 'var(--color-background-primary)',
              border: '0.5px solid var(--color-border-tertiary)',
              borderLeft: '3px solid #F59E0B',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#F59E0B15',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                }}
              >
                📝
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    margin: 0,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  Catatan Kunjungan
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Kondisi sosial, respons warga, temuan penting
                </p>
              </div>
            </div>
            <FormTextarea
              label="Catatan"
              value={form.stakeholderNotes}
              onChange={setField('stakeholderNotes')}
              placeholder="Contoh: Warga antusias, RW minta sosialisasi lanjutan sebelum pemasangan. Ada 3 rumah yang menolak di RT 02..."
              rows={4}
              hint="Catatan ini akan muncul di BA Open dan laporan survey"
            />
          </div>

          {/* FIX: action bar — toggle between save button and next-step banner */}
          {!saved ? (
            <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 28px',
                  borderRadius: 10,
                  border: 'none',
                  background: saving ? 'var(--color-background-secondary)' : '#00D4B4',
                  color: saving ? 'var(--color-text-secondary)' : 'white',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: saving ? 'none' : '0 4px 14px #00D4B440',
                }}
              >
                <Save style={{ width: 16, height: 16 }} />
                {saving ? 'Menyimpan...' : 'Simpan Data Kunjungan'}
              </button>
              <button
                onClick={() => router.push(`/permit-clusters/${clusterId}`)}
                style={{
                  padding: '12px 20px',
                  borderRadius: 10,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  color: 'var(--color-text-secondary)',
                }}
              >
                Batal
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #00D4B415, #3B82F615)',
                border: '0.5px solid #00D4B440',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <CheckCircle style={{ width: 20, height: 20, color: '#00D4B4', flexShrink: 0 }} />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--color-text-primary)',
                    }}
                  >
                    Data kunjungan berhasil disimpan!
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Langkah berikutnya: Input Data Survey Lapangan
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}/survey-input`)}
                  style={{
                    padding: '10px 20px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#00D4B4',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Lanjut: Input Data Survey →
                </button>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}`)}
                  style={{
                    padding: '10px 16px',
                    borderRadius: 8,
                    border: '0.5px solid var(--color-border-tertiary)',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  Kembali ke Pipeline
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // FIX: read-only view for non-editors
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {([
            ['Nama RW', form.rwName, '#00D4B4'],
            ['HP RW', form.rwPhone, '#00D4B4'],
            ['Nama RT', form.rtName, '#3B82F6'],
            ['HP RT', form.rtPhone, '#3B82F6'],
            ['Pengelola', form.pengelolaName, '#8B5CF6'],
            ['HP Pengelola', form.pengelolaPhone, '#8B5CF6'],
            ['Catatan', form.stakeholderNotes, '#F59E0B'],
          ] as const).map(([label, value, color]) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 10,
                background: 'var(--color-background-secondary)',
                borderLeft: `3px solid ${color}`,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--color-text-primary)',
                  textAlign: 'right',
                }}
              >
                {value || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
