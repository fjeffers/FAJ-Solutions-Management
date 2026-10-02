'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print"
      style={{
        border: '1px solid rgba(14,27,46,0.35)', background: 'white', color: '#0E1B2E',
        borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
      }}
    >
      Download PDF / Print
    </button>
  );
}
