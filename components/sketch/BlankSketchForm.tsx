'use client';
// A blank sketch form to print or save as PDF (Fred, 2026-10-06: "downloadable
// forms" — "the sketch form"): grid paper at 1 square = 1 ft with a title
// block, and the same symbols and cable colours as the sketch pad, for drawing
// by hand on site. Prints alone, like the job log (#job-log-root).
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { CABLE_TYPES, SYMBOLS, SYMBOL_GROUPS } from '@/lib/sketch';

const COLS = 60, ROWS = 40;

export default function BlankSketchForm({ onClose, client, site }: { onClose: () => void; client?: string; site?: string }) {
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);

  const box = (label: string, value = '') => (
    <div style={{ border: '1px solid #cfd5de', borderRadius: 6, padding: '4px 8px', minHeight: 40 }}>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: '#78909C' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, minHeight: 16 }}>{value}</div>
    </div>
  );

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 330, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 1000, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 200px' }}>Blank sketch form</div>
        <span className="wf-p-small wf-subtle">Print it, or choose “Save as PDF” to download it.</span>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="jl-page" style={{ maxWidth: 1000, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 12 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions" style={{ height: 40, width: 'auto' }} />
          <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 18, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>SITE SKETCH</div>
        </div>
        <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 6 }}>
            {box('Client', client)}{box('Site / address', site)}{box('Date')}{box('Drawn by')}
          </div>

          <svg viewBox={`0 0 ${COLS} ${ROWS}`} style={{ width: '100%', display: 'block', border: '1px solid #b7bfcc' }} aria-label="Grid, 1 square = 1 ft">
            <defs>
              <pattern id="bs-g1" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#dfe3e9" strokeWidth={0.04} /></pattern>
              <pattern id="bs-g5" width={5} height={5} patternUnits="userSpaceOnUse"><rect width={5} height={5} fill="url(#bs-g1)" /><path d="M 5 0 L 0 0 0 5" fill="none" stroke="#b9c1cd" strokeWidth={0.08} /></pattern>
            </defs>
            <rect width={COLS} height={ROWS} fill="url(#bs-g5)" />
            {Array.from({ length: COLS / 5 + 1 }, (_, i) => (
              <text key={`x${i}`} x={i * 5 + 0.2} y={0.9} fontSize={0.7} fill="#90a4ae" fontFamily="Inter, sans-serif">{i * 5}</text>
            ))}
            {Array.from({ length: ROWS / 5 }, (_, i) => (
              <text key={`y${i}`} x={0.2} y={(i + 1) * 5 - 0.2} fontSize={0.7} fill="#90a4ae" fontFamily="Inter, sans-serif">{(i + 1) * 5}</text>
            ))}
          </svg>
          <div style={{ fontSize: 10.5, color: '#78909C' }}>1 square = 1 ft · heavy lines every 5 ft · write each room&apos;s name and size, and the length of each cable run.</div>

          <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E', marginBottom: 4 }}>Symbols</div>
              {SYMBOL_GROUPS.map((g) => (
                <div key={g.group} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 4 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, color: '#90a4ae', textTransform: 'uppercase', width: 80 }}>{g.label}</span>
                  {SYMBOLS.filter((s) => s.group === g.group).map((s) => (
                    <span key={s.kind} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {s.code
                        ? <span style={{ width: 18, height: 18, borderRadius: 999, border: `2px solid ${s.color}`, color: s.color, fontSize: s.code.length > 2 ? 6.5 : s.code.length > 1 ? 8 : 9.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{s.code}</span>
                        : <span style={{ width: 18, height: 4, background: s.color, display: 'inline-block' }} />}
                      {s.label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: '#0E1B2E', marginBottom: 4 }}>Cable runs</div>
              {CABLE_TYPES.map((c) => (
                <div key={c.type} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <svg width={28} height={6}><line x1={0} y1={3} x2={28} y2={3} stroke={c.color} strokeWidth={3} strokeDasharray="6 3" /></svg>
                  {c.label}
                </div>
              ))}
            </div>
          </div>

          <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {box('Notes')}{box('Signature')}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
