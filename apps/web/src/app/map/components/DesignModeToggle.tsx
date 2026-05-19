'use client';

import { useDesignStore } from '../../../store/useDesignStore';
import { toast } from 'sonner';

export type DesignModeToggleProps = {
  editMode: boolean;
  setEditMode: (next: boolean) => void | Promise<void>;
};

export function DesignModeToggle({ editMode, setEditMode }: DesignModeToggleProps) {
  const projectId = useDesignStore(s => s.projectId);

  const handleToggle = () => {
    const next = !editMode;
    if (next) {
      const pid = projectId?.trim();
      if (!pid) {
        toast.error('Masukkan Project ID di panel Desain Tersimpan sebelum mengaktifkan mode edit.');
        return;
      }
    }
    void setEditMode(next);
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 12,
        border: '1px solid #D1D5DB',
        borderRadius: 8,
        background: editMode ? '#065F46' : 'white',
        color: editMode ? 'white' : '#111827',
        padding: '8px 10px',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
      }}
      aria-pressed={editMode}
      title="Toggle design edit mode"
    >
      {editMode ? 'Edit Mode: ON' : 'Edit Mode: OFF'}
    </button>
  );
}
