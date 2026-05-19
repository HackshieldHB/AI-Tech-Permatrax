'use client';

// FIX: full modern UI rewrite — prominent GPS card, drag-drop zone, 3-col photo grid with geo chips
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '../../../../../store/authStore';
import { apiGet, fixFileUrl, API_BASE } from '../../../../../lib/api'; // FIX Issue 5: import fixFileUrl for URL rewrite + centralized API_BASE
import { toast } from 'sonner';
import {
  ArrowLeft, Upload, MapPin, AlertTriangle, Camera,
  ChevronRight,
} from 'lucide-react';
import type { SurveyEvidence } from '../../../../../types/api.types';
import { isPmOrSurveyorRole } from '../../../../../lib/roles';

const SURVEY_STEPS = ['BA Open', 'Kunjungan', 'Data Survey', 'Route', 'SIP', 'Dokumen'];

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

export default function EvidencePage() {
  const { id: clusterId } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, accessToken } = useAuthStore();

  const [cluster, setCluster] = useState<any>(null);
  const [photos, setPhotos] = useState<SurveyEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [dragOver, setDragOver] = useState(false); // FIX: drag-over visual state
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [c, list] = await Promise.all([
          apiGet<any>(`/permit-clusters/${clusterId}`),
          apiGet<SurveyEvidence[]>(`/permit-clusters/${clusterId}/survey/evidence`).catch(() => []),
        ]);
        setCluster(c);
        setPhotos(list);
      } catch {
        toast.error('Gagal memuat data cluster');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [clusterId]);

  useEffect(() => {
    // FIX: request GPS on mount with error fallback
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setGps(null),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    }
  }, []);

  const canUpload = isPmOrSurveyorRole(user?.role) || user?.role === 'ADMIN';

  const handleFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? Array.from(files) : [];
      if (!list.length) return;
      const apiBase = API_BASE; // FIX: centralized API URL (smart fallback for remote ngrok clients)

      setUploading(true);
      try {
        for (const file of list) {
          if (file.size > 10 * 1024 * 1024) {
            toast.error(`${file.name}: melebihi 10MB`);
            continue;
          }
          const fd = new FormData();
          fd.append('photos', file);
          if (gps) {
            fd.append('latitude', String(gps.lat));
            fd.append('longitude', String(gps.lng));
          }
          fd.append('capturedAt', new Date().toISOString());

          const res = await fetch(
            `${apiBase}/permit-clusters/${clusterId}/survey/evidence`,
            {
              method: 'POST',
              headers: {
                'ngrok-skip-browser-warning': 'true', // FIX: bypass ngrok-free interstitial
                ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
              },
              body: fd,
            },
          );
          if (!res.ok) {
            toast.error(`Upload ${file.name} gagal`);
            continue;
          }
        }
        toast.success('Foto berhasil diupload');
        const list2 = await apiGet<SurveyEvidence[]>(
          `/permit-clusters/${clusterId}/survey/evidence`,
        ).catch(() => []);
        setPhotos(list2);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [accessToken, clusterId, gps],
  );

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
          <span style={{ color: 'var(--color-text-primary)' }}>Foto Evidence</span>
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
              Foto Evidence Survey
            </h1>
            <p
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                margin: '4px 0 0',
              }}
            >
              Dokumentasi visual dengan GPS tagging — wajib untuk submit dokumen
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

      <StepIndicator current={5} />

      {/* FIX: prominent GPS status card */}
      <div
        style={{
          padding: '16px 20px',
          borderRadius: 12,
          background: gps ? '#22C55E15' : '#F59E0B15',
          border: `0.5px solid ${gps ? '#22C55E40' : '#F59E0B40'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: gps ? '#22C55E25' : '#F59E0B25',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {gps ? (
            <MapPin style={{ width: 22, height: 22, color: '#22C55E' }} />
          ) : (
            <AlertTriangle style={{ width: 22, height: 22, color: '#F59E0B' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: gps ? '#22C55E' : '#F59E0B',
            }}
          >
            {gps ? 'GPS Aktif' : 'GPS Tidak Tersedia'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              wordBreak: 'break-word',
            }}
          >
            {gps
              ? `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} — Foto akan ter-tag lokasi secara otomatis`
              : 'Aktifkan izin lokasi di browser untuk geo-tagging foto evidence'}
          </div>
        </div>
      </div>

      {canUpload ? (
        // FIX: modern drag-and-drop upload zone with visual feedback
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 20px',
            borderRadius: 12,
            border: `2px dashed ${dragOver ? '#00D4B4' : 'var(--color-border-tertiary)'}`,
            background: dragOver ? '#00D4B408' : 'var(--color-background-secondary)',
            cursor: uploading ? 'not-allowed' : 'pointer',
            transition: 'all 150ms',
            textAlign: 'center',
            minHeight: 180,
            marginBottom: 24,
            opacity: uploading ? 0.7 : 1,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#00D4B415',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            {uploading ? (
              <Upload style={{ width: 26, height: 26, color: '#00D4B4' }} />
            ) : (
              <Camera style={{ width: 26, height: 26, color: '#00D4B4' }} />
            )}
          </div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              marginBottom: 6,
            }}
          >
            {uploading ? 'Mengupload foto...' : 'Drag foto ke sini atau klik untuk upload'}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              maxWidth: 420,
              lineHeight: 1.5,
            }}
          >
            JPG, PNG — Max 10MB per foto · Multiple files didukung · Foto akan otomatis
            ter-tag dengan koordinat GPS
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => void handleFiles(e.target.files)}
          />
        </label>
      ) : null}

      {/* FIX: photo count header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            fontWeight: 500,
          }}
        >
          {photos.length > 0
            ? `📸 ${photos.length} foto tersimpan`
            : '📸 Belum ada foto evidence'}
        </div>
        {photos.length > 0 ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              padding: '4px 10px',
              borderRadius: 12,
              background: 'var(--color-background-secondary)',
            }}
          >
            {photos.filter((p) => p.latitude != null).length} ter-tag GPS
          </div>
        ) : null}
      </div>

      {/* FIX: photo grid — 3 columns responsive */}
      {photos.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                border: '0.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-secondary)',
                transition: 'transform 150ms',
              }}
            >
              <a
                href={fixFileUrl(photo.fileUrl)}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'block' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fixFileUrl(photo.fileUrl)}
                  alt={photo.fileName}
                  style={{
                    width: '100%',
                    aspectRatio: '4 / 3',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              </a>
              <div style={{ padding: '8px 10px' }}>
                {photo.latitude != null && photo.longitude != null ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10,
                      color: '#22C55E',
                      marginBottom: 3,
                      fontWeight: 500,
                    }}
                  >
                    <MapPin style={{ width: 10, height: 10 }} />
                    {Number(photo.latitude).toFixed(4)}, {Number(photo.longitude).toFixed(4)}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--color-text-secondary)',
                      marginBottom: 3,
                      fontStyle: 'italic',
                    }}
                  >
                    GPS: —
                  </div>
                )}
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {new Date(photo.capturedAt || photo.uploadedAt).toLocaleString('id-ID', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* FIX: bottom action bar */}
      <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
        <button
          onClick={() => router.push(`/permit-clusters/${clusterId}`)}
          style={{
            padding: '12px 22px',
            borderRadius: 10,
            border: 'none',
            background: '#00D4B4',
            color: 'white',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            boxShadow: '0 4px 14px #00D4B440',
          }}
        >
          Selesai — Kembali ke Pipeline
        </button>
      </div>
    </div>
  );
}
