// Burns the job, date, time and GPS into a photo (Fred, 2026-10-02: "time and
// date and GPS location on the pictures"). Browser only: it draws the picture
// onto a canvas, writes the lines from stampLines() (lib/geo.ts) as small white
// text in the lower-right corner, and returns a JPEG. No band behind the text:
// Fred, 2026-11-16, sending photos to a client: "I don't want it big and broad
// … just in the little spot, in a corner." The stamp is part of the image
// itself, so it travels with the photo wherever it is sent or printed.

const MAX_SIDE = 1920; // big enough to read a label, small enough to send on one bar

async function loadImage(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  // createImageBitmap honours the phone's rotation flag; an <img> is the fallback.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

export async function stampPhoto(file: Blob, lines: string[]): Promise<Blob> {
  const src = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(src.w, src.h));
    const w = Math.round(src.w * scale);
    const h = Math.round(src.h * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This phone could not prepare the photo.');
    ctx.drawImage(src.img, 0, 0, w, h);

    const font = Math.max(13, Math.min(28, Math.round(w / 44)));
    const lineH = Math.round(font * 1.18);
    const margin = Math.max(10, Math.round(Math.min(w, h) * 0.018));
    const maxWidth = Math.round(w * 0.5);
    const weight = (i: number) => `${i === 0 ? 700 : 500} ${font}px Inter, "Segoe UI", Arial, sans-serif`;
    // A long first line ("FAJ Solutions · WO … · job name") breaks at its dots
    // rather than stretching across the picture.
    const rows: { text: string; bold: boolean }[] = [];
    lines.forEach((line, i) => {
      ctx.font = weight(i);
      let row = '';
      for (const part of line.split(' · ')) {
        const next = row ? `${row} · ${part}` : part;
        if (row && ctx.measureText(next).width > maxWidth) { rows.push({ text: row, bold: i === 0 }); row = part; }
        else row = next;
      }
      rows.push({ text: row, bold: i === 0 });
    });

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.lineWidth = Math.max(3, font * 0.16);
    ctx.fillStyle = '#FFFFFF';
    rows.forEach((row, i) => {
      ctx.font = weight(row.bold ? 0 : 1);
      const y = h - margin - lineH * (rows.length - i - 0.5);
      // The dark outline keeps white text readable on a bright wall or ceiling.
      ctx.strokeText(row.text, w - margin, y, maxWidth);
      ctx.fillText(row.text, w - margin, y, maxWidth);
    });

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This phone could not save the photo.'))), 'image/jpeg', 0.86));
  } finally {
    src.close();
  }
}

/**
 * A receipt photo, made small enough to send on one bar — no stamp, so the
 * receipt itself stays readable (migration-103).
 */
export async function shrinkPhoto(file: Blob, maxSide = 1600): Promise<Blob> {
  const src = await loadImage(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(src.w, src.h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(src.w * scale);
    canvas.height = Math.round(src.h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This phone could not prepare the photo.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src.img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This phone could not save the photo.'))), 'image/jpeg', 0.85));
  } finally {
    src.close();
  }
}
