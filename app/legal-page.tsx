import type { ReactNode } from 'react';
import Link from 'next/link';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', background: '#F6F4EF', color: '#1B1C1F', padding: '40px 18px' }}>
      <article style={{
        maxWidth: 820,
        margin: '0 auto',
        background: '#fff',
        border: '1px solid #D9D2C3',
        borderRadius: 14,
        padding: 'clamp(24px, 5vw, 52px)',
        font: '15px/1.7 Inter, Arial, sans-serif',
      }}>
        <Link href="/" style={{ color: '#0E6670', fontWeight: 700, textDecoration: 'none' }}>FAJ Solutions</Link>
        <h1 style={{ margin: '12px 0 4px', font: '700 clamp(30px, 6vw, 46px)/1.05 "Cormorant Garamond", Georgia, serif' }}>{title}</h1>
        <p style={{ margin: '0 0 30px', color: '#5E6470' }}>Effective November 7, 2026</p>
        <div className="legal-copy">{children}</div>
      </article>
      <style>{`
        .legal-copy h2 { margin: 28px 0 6px; font-size: 18px; color: #0E1B2E; }
        .legal-copy p, .legal-copy ul { margin: 7px 0; }
        .legal-copy ul { padding-left: 22px; }
        .legal-copy a { color: #0E6670; }
      `}</style>
    </main>
  );
}
