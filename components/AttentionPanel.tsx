'use client';
import { useMemo } from 'react';
import { ChevronRight, CheckCircle2, AlertCircle, DollarSign } from 'lucide-react';
import { attentionItems, attentionSummary, type AttentionInput } from '@/lib/attention';

/**
 * "What needs you today", on the dashboard.
 *
 * Every figure here is computed in lib/attention.ts, not asked of a model.
 * Money math has to be exact, and it is one pass over data the app already
 * holds — so this is instant and free, and it is still right when the internet
 * is not.
 */
export default function AttentionPanel({
  data, onGo, flush = false,
}: {
  data: AttentionInput;
  onGo: (view: string) => void;
  /** No space underneath — the Dashboard's rows space their blocks themselves. */
  flush?: boolean;
}) {
  const items = useMemo(() => attentionItems(data), [data]);
  const summary = attentionSummary(items);

  if (items.length === 0) {
    return (
      <div className="glass card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', marginBottom: flush ? 0 : 20 }}>
        <CheckCircle2 size={20} color="#047857" style={{ flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Nothing needs you right now.</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>
            Everything walked is quoted, everything finished is billed, and every tech is paid.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: flush ? 0 : 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Waiting on you</h2>
        {summary && <div style={{ fontSize: 12.5, color: '#8a8578' }}>{summary}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 9 }}>
        {items.map((item) => {
          const isMoney = item.severity === 'money';
          return (
            <button
              key={item.kind}
              onClick={() => onGo(item.view)}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', cursor: 'pointer',
                padding: '13px 14px', borderRadius: 13, background: 'white',
                border: `1px solid ${isMoney ? 'rgba(14,27,46,0.25)' : '#eae5d8'}`,
                boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
              }}
            >
              <span style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: isMoney ? 'rgba(14,27,46,0.10)' : 'rgba(245,158,11,0.12)',
              }}>
                {isMoney
                  ? <DollarSign size={16} color="var(--teal)" />
                  : <AlertCircle size={16} color="#b45309" />}
              </span>

              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                  {item.title}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: '#8a8578', marginTop: 2 }}>
                  {item.detail}
                </span>
              </span>

              <ChevronRight size={16} color="#c9c3b4" style={{ flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
