import { useEffect } from 'react';
import { useDesignStore } from '../../../store/useDesignStore';
import { useCommandStore } from '../../../store/useCommandStore';
import type { ActiveTool } from '../../../store/useDesignStore';

const NODE_OPTIONS: { value: ActiveTool; label: string }[] = [
  { value: 'add-odp', label: 'ODP' },
  { value: 'add-odc', label: 'ODC' },
  { value: 'add-olt', label: 'OLT' },
  { value: 'add-splitter', label: 'Splitter' },
  { value: 'add-splice', label: 'Splice' },
  { value: 'add-pole', label: 'Tiang' },
  { value: 'add-connector', label: 'Konektor' },
];

const EDGE_OPTIONS: { value: ActiveTool; label: string }[] = [
  { value: 'add-edge-feeder', label: 'Feeder' },
  { value: 'add-edge-distribution', label: 'Distribusi' },
  { value: 'add-edge-drop', label: 'Drop' },
];

const btnBase: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap',
};

function btn(active: boolean, danger = false): React.CSSProperties {
  if (danger) {
    return {
      ...btnBase,
      border: active ? '1px solid #EF4444' : '1px solid #E5E7EB',
      background: active ? '#FEE2E2' : '#ffffff',
      color: active ? '#991B1B' : '#4B5563',
    };
  }
  return {
    ...btnBase,
    border: active ? '1px solid #3B82F6' : '1px solid #E5E7EB',
    background: active ? '#DBEAFE' : '#ffffff',
    color: active ? '#1E40AF' : '#4B5563',
  };
}

const selectStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #3B82F6',
  background: '#DBEAFE',
  color: '#1E40AF',
  borderRadius: '6px',
  fontSize: '13px',
  fontWeight: 500,
  cursor: 'pointer',
  outline: 'none',
};

const undoBtnStyle = (disabled: boolean): React.CSSProperties => ({
  ...btnBase,
  border: '1px solid #E5E7EB',
  background: disabled ? '#F9FAFB' : '#ffffff',
  color: disabled ? '#D1D5DB' : '#4B5563',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  fontSize: '15px',
  padding: '6px 8px',
});

export function DesignModeToolbar() {
  const {
    editMode, activeTool, setActiveTool, sketchMode, setSketchMode,
    sketchOpacity, setSketchOpacity, requestSketchTrash,
  } = useDesignStore();
  const appliedLen = useCommandStore((s) => s.applied.length);
  const undoneLen = useCommandStore((s) => s.undone.length);
  const isSaving = useCommandStore((s) => s.isSaving);

  const canUndo = appliedLen > 0 && !isSaving;
  const canRedo = undoneLen > 0 && !isSaving;

  // Keyboard shortcuts: Escape, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    if (!editMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveTool(null);
        useDesignStore.getState().setSelectedFeatureRef(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          useCommandStore.getState().undo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey)) {
          e.preventDefault();
          useCommandStore.getState().redo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editMode, setActiveTool]);

  if (!editMode) return null;

  const isNodeActive = activeTool !== null && !activeTool.startsWith('add-edge-') && activeTool.startsWith('add-');
  const isEdgeActive = activeTool !== null && activeTool.startsWith('add-edge-');

  return (
    <div
      style={{
        position: 'absolute',
        top: 56,
        right: 12,
        zIndex: 10,
        display: 'flex',
        gap: '4px',
        background: '#ffffff',
        padding: '4px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        alignItems: 'center',
      }}
    >
      {/* ── Undo / Redo ── */}
      <button
        onClick={() => useCommandStore.getState().undo()}
        disabled={!canUndo}
        style={undoBtnStyle(!canUndo)}
        title="Undo (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        onClick={() => useCommandStore.getState().redo()}
        disabled={!canRedo}
        style={undoBtnStyle(!canRedo)}
        title="Redo (Ctrl+Y)"
      >
        ↪
      </button>

      {/* ── Divider ── */}
      <div style={{ width: 1, height: 24, background: '#E5E7EB', margin: '0 2px' }} />

      {/* ── Select / Move ── */}
      <button onClick={() => setActiveTool(null)} style={btn(activeTool === null)}>
        Pilih/Geser
      </button>

      {/* ── Node Palette ── */}
      {isNodeActive ? (
        <select
          value={activeTool ?? ''}
          onChange={(e) => setActiveTool(e.target.value as ActiveTool)}
          style={selectStyle}
          title="Pilih tipe node untuk ditambahkan"
        >
          {NODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value!}>
              + {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setActiveTool('add-odp')}
          style={btn(false)}
          title="Tambah Node"
        >
          + Node
        </button>
      )}

      {/* ── Edge Palette ── */}
      {isEdgeActive ? (
        <select
          value={activeTool ?? ''}
          onChange={(e) => setActiveTool(e.target.value as ActiveTool)}
          style={selectStyle}
          title="Pilih tipe jalur untuk ditarik"
        >
          {EDGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value!}>
              ⤳ {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <button
          onClick={() => setActiveTool('add-edge-feeder')}
          style={btn(false)}
          title="Tambah Jalur"
        >
          + Jalur
        </button>
      )}

      {/* ── Sketch Mode Toggle ── */}
      <button 
        onClick={() => setSketchMode(!sketchMode)}
        style={{
          ...btnBase,
          border: sketchMode ? '1px solid #7C3AED' : '1px solid #E5E7EB',
          background: sketchMode ? '#EDE9FE' : '#ffffff',
          color: sketchMode ? '#5B21B6' : '#4B5563',
        }}
        title={sketchMode ? 'Keluar dari Mode Sketch' : 'Masuk ke Mode Sketch'}
      >
        {sketchMode ? '✏️ Sketch' : '📝 Sketch'}
      </button>

      {/* GIS Issue 8 / JLM Phase 2 Issue 2: cara hapus objek sketch dibuat eksplisit */}
      {sketchMode && (
        <span
          style={{
            fontSize: '11px',
            color: '#5B21B6',
            background: '#EDE9FE',
            borderRadius: 6,
            padding: '4px 8px',
            marginLeft: '4px',
            whiteSpace: 'nowrap',
          }}
        >
          💡 Pilih objek → klik Hapus (atau 🗑 di kanan atas)
        </span>
      )}

      {/* ── Sketch Opacity Slider ── */}
      {sketchMode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px' }}>
          <span style={{ fontSize: '12px', color: '#4B5563' }}>Opacity:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={sketchOpacity}
            onChange={(e) => setSketchOpacity(parseFloat(e.target.value))}
            style={{ width: '60px' }}
            title={`Sketch Opacity: ${(sketchOpacity * 100).toFixed(0)}%`}
          />
          <span style={{ fontSize: '12px', color: '#4B5563', minWidth: '30px' }}>
            {(sketchOpacity * 100).toFixed(0)}%
          </span>
        </div>
      )}

      {/* ── Delete: sketch trash vs node/edge delete ── */}
      <button
        onClick={() => {
          if (sketchMode) {
            requestSketchTrash();
          } else {
            setActiveTool('delete');
          }
        }}
        style={btn(sketchMode ? false : activeTool === 'delete', true)}
        title={sketchMode ? 'Hapus objek sketch yang dipilih' : 'Hapus node/jalur (klik objek)'}
      >
        {sketchMode ? 'Hapus Sketch' : 'Hapus'}
      </button>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}} />
    </div>
  );
}
