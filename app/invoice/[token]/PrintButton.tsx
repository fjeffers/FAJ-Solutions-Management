'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print"
      style={{
        border: '1px solid rgba(13,115,119,0.35)', background: 'white', color: '#0D7377',
        borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer',
      }}
    >
      Download PDF / Print
    </button>
  );
}
