'use client';
import { useRef, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';

export default function SignaturePad({ onSave, onCancel }: {
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasStrokes(true);
  };

  const endDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDrawing(false);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    onSave(canvas.toDataURL('image/png'));
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8 }}>Sign in the box below</div>
      <div style={{ position: 'relative', border: '2px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
        <canvas
          ref={canvasRef}
          width={600}
          height={200}
          style={{ width: '100%', height: 160, display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 13, color: '#ccc', fontStyle: 'italic' }}>Sign here</span>
          </div>
        )}
        <div style={{ borderTop: '1px solid #e5e7eb', height: 1, margin: '0 16px' }} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={clear}
          style={{ padding: '8px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 12, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}
        >
          <Trash2 size={12} /> Clear
        </button>
        <button onClick={onCancel} style={{ padding: '8px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, background: 'white', cursor: 'pointer', fontSize: 12, color: '#888' }}>
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!hasStrokes}
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: 'center', fontSize: 13, opacity: hasStrokes ? 1 : 0.4 }}
        >
          Save Signature
        </button>
      </div>
    </div>
  );
}
