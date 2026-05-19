import { useState, useEffect, useCallback } from 'react';
import { useDesignStore } from '../../../store/useDesignStore';
import { useCommandStore } from '../../../store/useCommandStore';
import type { UpdateNodeCommand, UpdateEdgeCommand } from '../commands/types';

/* ── Label / Color maps ── */

const NODE_TYPE_LABELS: Record<string, string> = {
  OLT: '📡 OLT',
  ODC: '🟣 ODC',
  ODP: '🟢 ODP',
  SPLITTER: '🩷 Splitter',
  SPLICE: '🟠 Splice',
  POLE: '⚫ Tiang',
  CONNECTOR: '🩵 Konektor',
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  FEEDER: '⚡ Feeder',
  DISTRIBUTION: '🔗 Distribusi',
  DROP: '🏠 Drop',
};

const TYPE_COLORS: Record<string, string> = {
  OLT: '#1D4ED8',
  ODC: '#7C3AED',
  ODP: '#16A34A',
  SPLITTER: '#EC4899',
  SPLICE: '#F97316',
  POLE: '#4B5563',
  CONNECTOR: '#14B8A6',
  FEEDER: '#D97706',
  DISTRIBUTION: '#0891B2',
  DROP: '#059669',
};

/* ── Shared input style factory ── */

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #E5E7EB',
  borderRadius: 6,
  fontSize: 13,
  color: '#111',
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#374151',
  marginBottom: 4,
};

/* ── Node sub-panel ── */

function NodeFields({
  refId,
  accentColor,
}: {
  refId: string;
  accentColor: string;
}) {
  const node = useDesignStore((s) => s.nodes[refId]);
  const [nameVal, setNameVal] = useState('');
  const [capacityVal, setCapacityVal] = useState('');

  useEffect(() => {
    if (!node) return;
    setNameVal((node.properties.name as string) ?? '');
    setCapacityVal(node.properties.capacity != null ? String(node.properties.capacity) : '');
  }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (field: string, newValue: unknown, oldValue: unknown) => {
      if (!node || newValue === oldValue) return;
      const cmd: UpdateNodeCommand = {
        type: 'UpdateNode',
        refId: node.refId,
        oldProperties: { [field]: oldValue },
        newProperties: { [field]: newValue },
      };
      useCommandStore.getState().dispatch(cmd);
    },
    [node],
  );

  const commitName = useCallback(() => {
    if (!node) return;
    const old = (node.properties.name as string) ?? '';
    if (nameVal !== old) commit('name', nameVal, old);
  }, [nameVal, node, commit]);

  const commitCapacity = useCallback(() => {
    if (!node) return;
    const old = node.properties.capacity ?? null;
    const parsed = capacityVal.trim() === '' ? null : Number(capacityVal);
    if (parsed !== old) commit('capacity', parsed, old);
  }, [capacityVal, node, commit]);

  if (!node) return null;

  return (
    <>
      {/* Origin + Coordinates */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            background: node.origin === 'MANUAL' ? '#DBEAFE' : '#F3F4F6',
            color: node.origin === 'MANUAL' ? '#1E40AF' : '#6B7280',
          }}
        >
          {node.origin}
        </span>
        <span style={{ fontSize: 11, color: '#9CA3AF' }}>
          ({node.coordinates[1].toFixed(6)}, {node.coordinates[0].toFixed(6)})
        </span>
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>Nama / Label</label>
        <input
          type="text"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }}
          placeholder={`${node.type}-001`}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = accentColor; }}
          onBlurCapture={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
        />
      </div>

      {/* Capacity */}
      <div>
        <label style={labelStyle}>Kapasitas</label>
        <input
          type="number"
          value={capacityVal}
          onChange={(e) => setCapacityVal(e.target.value)}
          onBlur={commitCapacity}
          onKeyDown={(e) => { if (e.key === 'Enter') commitCapacity(); }}
          placeholder="0"
          min={0}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = accentColor; }}
          onBlurCapture={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
        />
      </div>
    </>
  );
}

/* ── Edge sub-panel ── */

function EdgeFields({
  refId,
  accentColor,
}: {
  refId: string;
  accentColor: string;
}) {
  const edge = useDesignStore((s) => s.edges[refId]);
  const [nameVal, setNameVal] = useState('');
  const [coreCountVal, setCoreCountVal] = useState('');
  const [installType, setInstallType] = useState<string>('');

  useEffect(() => {
    if (!edge) return;
    setNameVal((edge.properties.name as string) ?? '');
    setCoreCountVal(edge.properties.coreCount != null ? String(edge.properties.coreCount) : '');
    setInstallType((edge.properties.installationType as string) ?? '');
  }, [refId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (field: string, newValue: unknown, oldValue: unknown) => {
      if (!edge || newValue === oldValue) return;
      const cmd: UpdateEdgeCommand = {
        type: 'UpdateEdge',
        refId: edge.refId,
        oldProperties: { [field]: oldValue },
        newProperties: { [field]: newValue },
      };
      useCommandStore.getState().dispatch(cmd);
    },
    [edge],
  );

  const commitName = useCallback(() => {
    if (!edge) return;
    const old = (edge.properties.name as string) ?? '';
    if (nameVal !== old) commit('name', nameVal, old);
  }, [nameVal, edge, commit]);

  const commitCoreCount = useCallback(() => {
    if (!edge) return;
    const old = edge.properties.coreCount ?? null;
    const parsed = coreCountVal.trim() === '' ? null : Number(coreCountVal);
    if (parsed !== old) commit('coreCount', parsed, old);
  }, [coreCountVal, edge, commit]);

  const commitInstallType = useCallback(
    (value: string) => {
      if (!edge) return;
      const old = (edge.properties.installationType as string) ?? '';
      if (value !== old) commit('installationType', value || null, old || null);
    },
    [edge, commit],
  );

  if (!edge) return null;

  const fromNode = useDesignStore.getState().nodes[edge.fromRef];
  const toNode = useDesignStore.getState().nodes[edge.toRef];

  return (
    <>
      {/* Origin + Endpoint summary */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 4,
            background: edge.origin === 'MANUAL' ? '#DBEAFE' : '#F3F4F6',
            color: edge.origin === 'MANUAL' ? '#1E40AF' : '#6B7280',
          }}
        >
          {edge.origin}
        </span>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>
          {fromNode?.type ?? '?'} → {toNode?.type ?? '?'} · {edge.coordinates.length} titik
        </span>
      </div>

      {/* Name */}
      <div>
        <label style={labelStyle}>Nama Jalur</label>
        <input
          type="text"
          value={nameVal}
          onChange={(e) => setNameVal(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') commitName(); }}
          placeholder={`${edge.type}-001`}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = accentColor; }}
          onBlurCapture={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
        />
      </div>

      {/* Core Count */}
      <div>
        <label style={labelStyle}>Jumlah Core</label>
        <input
          type="number"
          value={coreCountVal}
          onChange={(e) => setCoreCountVal(e.target.value)}
          onBlur={commitCoreCount}
          onKeyDown={(e) => { if (e.key === 'Enter') commitCoreCount(); }}
          placeholder="0"
          min={0}
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = accentColor; }}
          onBlurCapture={(e) => { e.target.style.borderColor = '#E5E7EB'; }}
        />
      </div>

      {/* Installation Type */}
      <div>
        <label style={labelStyle}>Tipe Pemasangan</label>
        <select
          value={installType}
          onChange={(e) => {
            setInstallType(e.target.value);
            commitInstallType(e.target.value);
          }}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            appearance: 'auto',
          }}
        >
          <option value="">— Pilih —</option>
          <option value="Aerial">Aerial (Udara)</option>
          <option value="Underground">Underground (Bawah Tanah)</option>
        </select>
      </div>
    </>
  );
}

/* ── Main Panel ── */

export function DesignPropertiesPanel() {
  const editMode = useDesignStore((s) => s.editMode);
  const selectedRef = useDesignStore((s) => s.selectedFeatureRef);
  const node = useDesignStore((s) => (s.selectedFeatureRef ? s.nodes[s.selectedFeatureRef] : undefined));
  const edge = useDesignStore((s) => (s.selectedFeatureRef ? s.edges[s.selectedFeatureRef] : undefined));

  if (!editMode || !selectedRef) return null;

  const isNode = !!node;
  const isEdge = !!edge;
  if (!isNode && !isEdge) return null;

  const featureType = isNode ? node!.type : edge!.type;
  const typeLabel = isNode
    ? (NODE_TYPE_LABELS[featureType] ?? featureType)
    : (EDGE_TYPE_LABELS[featureType] ?? featureType);
  const typeColor = TYPE_COLORS[featureType] ?? '#374151';
  const featureRefId = isNode ? node!.refId : edge!.refId;

  return (
    <div
      style={{
        position: 'absolute',
        top: 108,
        right: 12,
        zIndex: 10,
        width: 260,
        background: '#ffffff',
        borderRadius: '10px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          background: `linear-gradient(135deg, ${typeColor}18, ${typeColor}08)`,
          borderBottom: `2px solid ${typeColor}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: typeColor }}>
            {typeLabel}
          </div>
          <div
            style={{
              fontSize: 10,
              color: '#9CA3AF',
              fontFamily: 'monospace',
              marginTop: 2,
            }}
          >
            {featureRefId.length > 20 ? `${featureRefId.slice(0, 20)}…` : featureRefId}
          </div>
        </div>
        <button
          onClick={() => useDesignStore.getState().setSelectedFeatureRef(null)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            color: '#9CA3AF',
            padding: '2px 4px',
            lineHeight: 1,
          }}
          title="Tutup (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Fields */}
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isNode && <NodeFields refId={selectedRef} accentColor={typeColor} />}
        {isEdge && <EdgeFields refId={selectedRef} accentColor={typeColor} />}
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: '6px 14px',
          background: '#F9FAFB',
          borderTop: '1px solid #F3F4F6',
          fontSize: 10,
          color: '#9CA3AF',
          textAlign: 'center',
        }}
      >
        Enter untuk simpan · Esc untuk tutup
      </div>
    </div>
  );
}
