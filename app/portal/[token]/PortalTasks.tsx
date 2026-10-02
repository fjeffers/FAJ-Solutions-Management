'use client';
import { useState } from 'react';
import type { WoTask } from '@/lib/types';

interface Props {
  woId: string;
  token: string;
  tasks: WoTask[];
}

const CATEGORY_ORDER = ['Pre Visit', 'Prep', 'On Site', 'Post Site', 'Post'] as const;
const CATEGORY_LABEL: Record<string, string> = {
  'Pre Visit': '📋 Pre-Visit',
  Prep:        '📋 Pre-Visit',
  'On Site':   '🔧 On Site',
  'Post Site': '📤 Post-Site',
  Post:        '📤 Post-Site',
};
const CATEGORY_COLOR: Record<string, string> = {
  'Pre Visit': '#1D4ED8',
  Prep:        '#1D4ED8',
  'On Site':   '#B45309',
  'Post Site': '#047857',
  Post:        '#047857',
};

export default function PortalTasks({ woId, token, tasks: initialTasks }: Props) {
  const [tasks, setTasks]     = useState<WoTask[]>(initialTasks);
  const [saving, setSaving]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // Group tasks by normalised category
  const groups = new Map<string, WoTask[]>();
  for (const t of tasks) {
    const cat = t.category === 'Prep' ? 'Pre Visit' : t.category === 'Post' ? 'Post Site' : t.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(t);
  }

  async function toggle(taskId: string) {
    if (saving) return;
    const updated = tasks.map((t) =>
      t.id === taskId
        ? { ...t, completed: !t.completed, completed_at: !t.completed ? new Date().toISOString() : null }
        : t,
    );
    setTasks(updated);
    setSaving(taskId);
    setError(null);
    try {
      const res = await fetch('/api/portal/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, wo_id: woId, field: 'wo_tasks', value: updated }),
      });
      if (!res.ok) throw new Error('Failed to save');
    } catch {
      // Revert on error
      setTasks(tasks);
      setError('Could not save. Please try again.');
    } finally {
      setSaving(null);
    }
  }

  const total     = tasks.length;
  const completed = tasks.filter((t) => t.completed).length;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Progress bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>✅</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase' }}>
              Tasks
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? '#047857' : '#aaa' }}>
              {completed}/{total} {pct === 100 ? '🎉' : ''}
            </span>
          </div>
          <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: pct === 100
                ? 'linear-gradient(90deg, #059669, #047857)'
                : 'linear-gradient(90deg, #0E1B2E, #13284A)',
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* Task groups */}
      {CATEGORY_ORDER.filter((c, i, arr) => {
        const normC = c === 'Prep' ? 'Pre Visit' : c === 'Post' ? 'Post Site' : c;
        return groups.has(normC) && arr.findIndex(x => (x === 'Prep' ? 'Pre Visit' : x === 'Post' ? 'Post Site' : x) === normC) === i;
      }).map((rawCat) => {
        const cat = rawCat === 'Prep' ? 'Pre Visit' : rawCat === 'Post' ? 'Post Site' : rawCat;
        const catTasks = groups.get(cat);
        if (!catTasks || catTasks.length === 0) return null;
        const color = CATEGORY_COLOR[cat] ?? '#555';
        const label = CATEGORY_LABEL[cat] ?? cat;
        return (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
              {label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {catTasks.map((task) => {
                const isSaving = saving === task.id;
                return (
                  <button
                    key={task.id}
                    onClick={() => toggle(task.id)}
                    disabled={!!saving}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      background: task.completed ? 'rgba(4,120,87,0.07)' : 'rgba(0,0,0,0.02)',
                      border: `1px solid ${task.completed ? 'rgba(4,120,87,0.2)' : '#e5e7eb'}`,
                      borderRadius: 8,
                      cursor: saving ? 'wait' : 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                      border: task.completed ? 'none' : '2px solid #d1d5db',
                      background: task.completed ? '#047857' : 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {task.completed && <span style={{ color: 'white', fontSize: 12, fontWeight: 900 }}>✓</span>}
                      {isSaving && <span style={{ fontSize: 10 }}>⏳</span>}
                    </div>
                    <span style={{
                      fontSize: 13,
                      color: task.completed ? '#6b7280' : '#1a1a1a',
                      textDecoration: task.completed ? 'line-through' : 'none',
                      fontWeight: task.completed ? 400 : 500,
                    }}>
                      {task.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{error}</div>
      )}
    </div>
  );
}
