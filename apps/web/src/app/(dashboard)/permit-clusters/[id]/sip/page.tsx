'use client';

// FIX: full modern UI rewrite — 3 colored sections, auto-fill from cluster, next-step banner
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, apiPost, apiPatch, uploadFile } from '../../../../../lib/api'; // FIX 2: uploadFile helper for KMZ
import { toast } from 'sonner';
import {
  ArrowLeft, Save, Home, Users, FileText,
  ChevronRight, CheckCircle,
} from 'lucide-react';
import { isPmRole, isSurveyorRole } from '../../../../../lib/roles';

const SURVEY_STEPS = ['BA Open', 'Kunjungan', 'Data Survey', 'Route', 'SIP', 'Dokumen'];

const RESIDENCE_TYPES = ['CLUSTER', 'PERUMAHAN', 'APARTEMEN', 'RUKO'];
const WORK_METHODS   = ['AERIAL', 'UNDERGROUND', 'DUCTING'];

function FormInput({
  label, value, onChange, placeholder, type = 'text', hint, accent = '#00D4B4',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
  accent?: string;
}) {
  const [focused, setFocused] = useState(false); // FIX: focus accent per-field
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
          border: `1.5px solid ${focused ? accent : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
        }}
      />
      {hint ? (
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FormSelect({
  label, value, onChange, options, accent = '#00D4B4',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  accent?: string;
}) {
  const [focused, setFocused] = useState(false);
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '10px 12px',
          borderRadius: 8,
          fontSize: 14,
          border: `1.5px solid ${focused ? accent : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormTextarea({
  label, value, onChange, placeholder, rows = 3, accent = '#00D4B4',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  accent?: string;
}) {
  const [focused, setFocused] = useState(false);
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
          border: `1.5px solid ${focused ? accent : 'var(--color-border-tertiary)'}`,
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          outline: 'none',
          resize: 'vertical',
          transition: 'border-color 150ms',
          fontFamily: 'inherit',
        }}
      />
    </div>
  );
}

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

export default function SipFormPage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [sip, setSip] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // FIX: post-save banner state

  const [form, setForm] = useState({
    siteName: '',
    coordinates: '',
    residenceType: 'CLUSTER',
    classing: '',
    workMethod: 'AERIAL',
    homepasCount: '',
    occupancyPercent: '',
    existingCompetitors: '',
    picKawasan: '',
    requestBy: '',
    picFs: '',
    picCbn: '',
    branch: '',
    boundaryKmzUrl: '', // FIX 2: boundary KMZ URL (SIP spec field 11)
    provinsi: '',
    kota: '',
    kecamatan: '',
    kelurahan: '',
    alamat: '',
    remarks: '',
  });

  // FIX 2: KMZ upload local state
  const [uploadingKmz, setUploadingKmz] = useState(false);
  const [kmzFileName, setKmzFileName] = useState('');

  const setField = useCallback(
    (key: keyof typeof form) => (value: string) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiGet<any>(`/permit-clusters/${clusterId}`);
        setCluster(data);
        const cl = data?.visitRequest?.cleanList;

        let sipRecord: any = null;
        try {
          sipRecord = await apiGet<any>(`/permit-clusters/${clusterId}/sip`);
        } catch {
          sipRecord = null;
        }
        setSip(sipRecord);

        if (sipRecord) {
          if (sipRecord.boundaryKmzUrl) {
            // FIX 2: derive filename from stored URL when record has a KMZ already
            try {
              const u = decodeURIComponent(String(sipRecord.boundaryKmzUrl));
              const last = u.split('/').pop() || 'boundary.kmz';
              setKmzFileName(last.replace(/^\d+-/, ''));
            } catch {
              setKmzFileName('boundary.kmz');
            }
          }
          // FIX: pre-fill from existing SIP record
          setForm({
            siteName:            sipRecord.siteName || data?.clusterCode || '',
            coordinates:         sipRecord.coordinates || '',
            residenceType:       sipRecord.residenceType || 'CLUSTER',
            classing:            sipRecord.classing || '',
            workMethod:          sipRecord.workMethod || 'AERIAL',
            homepasCount:        sipRecord.homepasCount != null ? String(sipRecord.homepasCount) : '',
            occupancyPercent:    sipRecord.occupancyPercent != null ? String(sipRecord.occupancyPercent) : '',
            existingCompetitors: sipRecord.existingCompetitors || '',
            picKawasan:          sipRecord.picKawasan || '',
            requestBy:           sipRecord.requestBy || '',
            picFs:               sipRecord.picFs || '',
            picCbn:              sipRecord.picCbn || '',
            branch:              sipRecord.branch || '',
            boundaryKmzUrl:      sipRecord.boundaryKmzUrl || '', // FIX 2: pre-fill KMZ URL
            provinsi:            sipRecord.provinsi || cl?.provinsi || '',
            kota:                sipRecord.kota || cl?.kotaKabupaten || '',
            kecamatan:           sipRecord.kecamatan || cl?.kecamatan || '',
            kelurahan:           sipRecord.kelurahan || cl?.kelurahan || '',
            alamat:              sipRecord.alamat || '',
            remarks:             sipRecord.remarks || '',
          });
        } else {
          // FIX: auto-fill from cluster on first-time SIP form
          setForm((prev) => ({
            ...prev,
            siteName:     data?.clusterCode || '',
            provinsi:     cl?.provinsi || 'JAWA BARAT',
            kota:         cl?.kotaKabupaten || '',
            kecamatan:    cl?.kecamatan || '',
            kelurahan:    cl?.kelurahan || '',
            homepasCount: cl?.homepasCount != null ? String(cl.homepasCount) : '',
          }));
        }
      } catch {
        toast.error('Gagal memuat data cluster');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [clusterId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let sipId: string | undefined = sip?.id;
      if (!sipId) {
        const created = await apiPost<{ id: string }>(
          `/permit-clusters/${clusterId}/sip/init`,
          {},
        ); // FIX: create SIP record if not exists
        sipId = created.id;
      }
      await apiPatch(`/permit-clusters/${clusterId}/sip/${sipId}`, {
        ...form, // FIX 2: includes boundaryKmzUrl from state
        homepasCount:     form.homepasCount     !== '' ? Number(form.homepasCount)     : undefined,
        occupancyPercent: form.occupancyPercent !== '' ? Number(form.occupancyPercent) : undefined,
      });
      setSaved(true); // FIX: show next-step banner instead of immediate navigation
      toast.success('Data SIP berhasil disimpan');
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menyimpan SIP');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitToIsp = async () => {
    if (!sip?.id || !clusterId) {
      toast.error('SIP belum tersimpan — simpan data terlebih dahulu');
      return;
    }
    setSaving(true);
    try {
      await apiPost(`/permit-clusters/${clusterId}/sip/${sip.id}/submit-to-isp`, {});
      toast.success(
        sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED'
          ? 'SIP berhasil dikirim ulang ke ISP'
          : 'SIP berhasil dikirim ke ISP',
      );
      const refreshed = await apiGet<any>(`/permit-clusters/${clusterId}/sip`);
      setSip(refreshed);
      setSaved(false);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal mengirim SIP ke ISP');
    } finally {
      setSaving(false);
    }
  };

  const st = sip?.status as string | undefined;
  const editableStatuses = ['DRAFT', 'FILLED', 'ISP_REVISION', 'REJECTED'];
  const canEdit =
    !!user &&
    (!sip
      ? isSurveyorRole(user.role) || isPmRole(user.role) || user.role === 'ADMIN'
      : (user.role === 'ADMIN' && editableStatuses.includes(st || '')) ||
        (isSurveyorRole(user.role) && editableStatuses.includes(st || '')) ||
        (isPmRole(user.role) && editableStatuses.includes(st || '')));

  const canSubmitToIsp =
    user?.role === 'ADMIN' &&
    !!sip?.id &&
    ['DRAFT', 'FILLED', 'ISP_REVISION', 'REJECTED'].includes(sip?.status || '');

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
        <div>⏳ Memuat data SIP...</div>
      </div>
    );
  }

  const cl = cluster?.visitRequest?.cleanList;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 0 60px' }}>
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
          <span style={{ color: 'var(--color-text-primary)' }}>SIP Form</span>
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
              Form SIP — Site Information Package
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Phase 8 — 19 fields · Data final untuk dikirim ke ISP
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

      <StepIndicator current={4} />

      {/* FIX: auto-fill info banner */}
      {!sip ? (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 10,
            background: '#3B82F615',
            border: '0.5px solid #3B82F640',
            marginBottom: 16,
            fontSize: 12,
            color: 'var(--color-text-secondary)',
          }}
        >
          <strong style={{ color: '#3B82F6' }}>✨ Auto-fill aktif</strong> — Data
          lokasi dan homepass sudah dipre-fill dari data cluster. Anda bisa edit jika perlu.
        </div>
      ) : null}

      {(sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED') && (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 12,
            marginBottom: 16,
            background: '#EF444415',
            border: '1.5px solid #EF444440',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <span style={{ fontSize: 24, flexShrink: 0 }}>❌</span>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#EF4444',
                marginBottom: 6,
              }}
            >
              {sip?.status === 'REJECTED'
                ? 'SIP Ditolak ISP — silakan revisi dan submit ulang'
                : 'SIP Ditolak ISP — Revisi Diperlukan'}
            </div>
            {(() => {
              const r = sip?.rejectionReason?.trim();
              const f = sip?.ispFeedback?.trim();
              if (r) {
                return (
                  <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 6 }}>
                    <strong>Alasan penolakan:</strong> {r}
                  </div>
                );
              }
              if (f) {
                return (
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                    <strong>Feedback ISP:</strong> {f}
                  </div>
                );
              }
              return (
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                  ISP meminta perbaikan data SIP.
                </div>
              );
            })()}
            {sip?.rejectionReason?.trim() &&
            sip?.ispFeedback?.trim() &&
            sip.rejectionReason.trim() !== sip.ispFeedback.trim() ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                <strong>Feedback ISP:</strong> {sip.ispFeedback}
              </div>
            ) : null}
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                marginTop: 8,
                fontStyle: 'italic',
              }}
            >
              Perbarui data SIP di bawah, simpan, lalu gunakan tombol &quot;Submit Ulang ke ISP&quot; (Admin).
            </div>
          </div>
        </div>
      )}

      {canEdit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* FIX: SECTION 1 — Informasi Lokasi & Teknis (teal accent, 8 fields) */}
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
                <Home style={{ width: 16, height: 16, color: '#00D4B4' }} />
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
                  Informasi Lokasi & Teknis
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Data site, tipe hunian, metode kerja, dan homepass
                </p>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              <FormInput
                label="Site Name"
                value={form.siteName}
                onChange={setField('siteName')}
                placeholder="Auto-filled dari cluster code"
                accent="#00D4B4"
              />
              <FormInput
                label="Koordinat GPS"
                value={form.coordinates}
                onChange={setField('coordinates')}
                placeholder="-6.5835, 106.7192"
                hint="Format: latitude, longitude"
                accent="#00D4B4"
              />
              <FormSelect
                label="Tipe Hunian"
                value={form.residenceType}
                onChange={setField('residenceType')}
                options={RESIDENCE_TYPES}
                accent="#00D4B4"
              />
              <FormInput
                label="Classing"
                value={form.classing}
                onChange={setField('classing')}
                placeholder="Contoh: C+"
                accent="#00D4B4"
              />
              <FormSelect
                label="Metode Kerja"
                value={form.workMethod}
                onChange={setField('workMethod')}
                options={WORK_METHODS}
                accent="#00D4B4"
              />
              <FormInput
                label="Target Homepass"
                value={form.homepasCount}
                onChange={setField('homepasCount')}
                placeholder="Jumlah HP"
                type="number"
                accent="#00D4B4"
              />
              <FormInput
                label="Occupancy (%)"
                value={form.occupancyPercent}
                onChange={setField('occupancyPercent')}
                placeholder="0-100"
                type="number"
                accent="#00D4B4"
              />
              <FormInput
                label="Existing Competitors"
                value={form.existingCompetitors}
                onChange={setField('existingCompetitors')}
                placeholder="Indihome, MyRepublic"
                accent="#00D4B4"
              />

              {/* FIX 2: Boundary KMZ file upload — SIP spec field 11, full width */}
              <div style={{ gridColumn: '1 / -1' }}>
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
                  Boundary KMZ File
                </label>

                {form.boundaryKmzUrl ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: '#22C55E15',
                      border: '1.5px solid #22C55E40',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: 20 }}>📦</span>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--color-text-primary)',
                          wordBreak: 'break-all',
                        }}
                      >
                        {kmzFileName || 'boundary.kmz'}
                      </div>
                      <div style={{ fontSize: 11, color: '#22C55E' }}>
                        ✓ File berhasil diupload
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a
                        href={form.boundaryKmzUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          background: 'var(--color-background-secondary)',
                          color: 'var(--color-text-info)',
                          textDecoration: 'none',
                        }}
                      >
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setForm((p) => ({ ...p, boundaryKmzUrl: '' })); // FIX 2: clear KMZ
                          setKmzFileName('');
                        }}
                        style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          background: '#EF444415',
                          color: '#EF4444',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ) : (
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '14px 18px',
                      borderRadius: 8,
                      cursor: uploadingKmz ? 'wait' : 'pointer',
                      border: `1.5px dashed ${uploadingKmz ? '#00D4B4' : 'var(--color-border-tertiary)'}`,
                      background: uploadingKmz ? '#00D4B408' : 'var(--color-background-secondary)',
                      transition: 'all 150ms',
                    }}
                  >
                    <span style={{ fontSize: 28, flexShrink: 0 }}>
                      {uploadingKmz ? '⏳' : '📦'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {uploadingKmz ? 'Mengupload...' : 'Upload file KMZ boundary cluster'}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-secondary)',
                          marginTop: 2,
                        }}
                      >
                        Format .kmz / .kml (Google Earth) — File batas wilayah cluster
                      </div>
                    </div>
                    <input
                      type="file"
                      accept=".kmz,.kml"
                      disabled={uploadingKmz}
                      style={{ display: 'none' }}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 20 * 1024 * 1024) {
                          toast.error('File terlalu besar. Maksimal 20MB');
                          e.target.value = '';
                          return;
                        }
                        setUploadingKmz(true);
                        try {
                          const url = await uploadFile(file, 'sip-kmz', clusterId); // FIX 2: upload to storage/upload
                          setForm((p) => ({ ...p, boundaryKmzUrl: url }));
                          setKmzFileName(file.name);
                          toast.success(`✅ KMZ "${file.name}" berhasil diupload`);
                        } catch (err: any) {
                          toast.error(`Upload gagal: ${err?.message || 'unknown error'}`);
                        } finally {
                          setUploadingKmz(false);
                          e.target.value = '';
                        }
                      }}
                    />
                  </label>
                )}

                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-secondary)',
                    margin: '5px 0 0',
                  }}
                >
                  💡 File KMZ boundary diperlukan untuk pengiriman SIP ke ISP.
                  Buat dari Google Earth dengan menandai batas wilayah cluster.
                </p>
              </div>
            </div>
          </div>

          {/* FIX: SECTION 2 — Kontak & PIC (blue accent, 5 fields) */}
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
                <Users style={{ width: 16, height: 16, color: '#3B82F6' }} />
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
                  Kontak & PIC
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Person in charge internal dan dari pihak ISP
                </p>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
              }}
            >
              <FormInput
                label="PIC Kawasan"
                value={form.picKawasan}
                onChange={setField('picKawasan')}
                placeholder="Nama pengelola kawasan"
                accent="#3B82F6"
              />
              <FormInput
                label="Request By"
                value={form.requestBy}
                onChange={setField('requestBy')}
                placeholder="Nama pemohon dari ISP"
                accent="#3B82F6"
              />
              <FormInput
                label="PIC FiberStar"
                value={form.picFs}
                onChange={setField('picFs')}
                placeholder="Nama PIC FS"
                accent="#3B82F6"
              />
              <FormInput
                label="PIC CBN"
                value={form.picCbn}
                onChange={setField('picCbn')}
                placeholder="Nama PIC CBN"
                accent="#3B82F6"
              />
              <FormInput
                label="Branch"
                value={form.branch}
                onChange={setField('branch')}
                placeholder="Contoh: Jabodetabek"
                accent="#3B82F6"
              />
            </div>
          </div>

          {/* FIX: SECTION 3 — Alamat Lengkap (purple accent, 6 fields) */}
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
                <FileText style={{ width: 16, height: 16, color: '#8B5CF6' }} />
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
                  Alamat Lengkap
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    margin: 0,
                  }}
                >
                  Wilayah administratif + alamat detail + remarks
                </p>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 14,
                marginBottom: 14,
              }}
            >
              <FormInput
                label="Provinsi"
                value={form.provinsi}
                onChange={setField('provinsi')}
                placeholder="Auto-filled"
                accent="#8B5CF6"
              />
              <FormInput
                label="Kota / Kabupaten"
                value={form.kota}
                onChange={setField('kota')}
                placeholder="Auto-filled"
                accent="#8B5CF6"
              />
              <FormInput
                label="Kecamatan"
                value={form.kecamatan}
                onChange={setField('kecamatan')}
                placeholder="Auto-filled"
                accent="#8B5CF6"
              />
              <FormInput
                label="Kelurahan"
                value={form.kelurahan}
                onChange={setField('kelurahan')}
                placeholder="Auto-filled"
                accent="#8B5CF6"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormTextarea
                label="Alamat Detail"
                value={form.alamat}
                onChange={setField('alamat')}
                placeholder="Alamat lengkap: nama jalan, RT/RW, nomor, patokan"
                rows={2}
                accent="#8B5CF6"
              />
              <FormTextarea
                label="Remarks"
                value={form.remarks}
                onChange={setField('remarks')}
                placeholder="Contoh: Di area RW 01 ada 10 RT. Jam akses 08:00-20:00."
                rows={3}
                accent="#8B5CF6"
              />
            </div>
          </div>

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
                {saving ? 'Menyimpan...' : sip ? 'Update Data SIP' : 'Simpan Data SIP'}
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
          ) : sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED' ? (
            <div
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #F59E0B15, #EF444415)',
                border: '0.5px solid #F59E0B40',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <CheckCircle style={{ width: 20, height: 20, color: '#F59E0B', flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    Perubahan SIP disimpan
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Admin dapat mengirim ulang ke ISP dengan tombol &quot;Submit Ulang ke ISP&quot; di bawah.
                  </div>
                </div>
              </div>
              <button
                type="button"
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
                    Data SIP berhasil disimpan!
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    Langkah berikutnya: Upload Foto Evidence Survey
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => router.push(`/permit-clusters/${clusterId}/evidence`)}
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
                  Lanjut: Upload Foto Evidence →
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

          {canSubmitToIsp ? (
            <div style={{ paddingTop: 8, paddingBottom: 8 }}>
              <button
                type="button"
                onClick={() => void handleSubmitToIsp()}
                disabled={saving}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 28px',
                  borderRadius: 10,
                  border: 'none',
                  background:
                    sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED'
                      ? 'linear-gradient(135deg, #F59E0B, #D97706)'
                      : 'linear-gradient(135deg, #00D4B4, #00B89E)',
                  color: 'white',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow:
                    sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED'
                      ? '0 4px 14px #F59E0B40'
                      : '0 4px 14px #00D4B440',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                <span style={{ fontSize: 16 }}>
                  {sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED' ? '🔄' : '📤'}
                </span>
                {saving
                  ? 'Mengirim...'
                  : sip?.status === 'ISP_REVISION' || sip?.status === 'REJECTED'
                    ? 'Submit Ulang ke ISP'
                    : 'Kirim SIP ke ISP'}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
          Anda tidak dapat mengedit data SIP pada status ini.
        </p>
      )}
    </div>
  );
}
