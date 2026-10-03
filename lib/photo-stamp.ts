// Burns the job, date, time and GPS into a photo (Fred, 2026-10-02: "time and
// date and GPS location on the pictures"). Browser only: it draws the picture
// onto a canvas, adds a dark band along the bottom with the lines from
// stampLines() (lib/geo.ts), and returns a JPEG. The stamp is part of the
// image itself, so it travels with the photo wherever it is sent or printed.

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

    const font = Math.max(15, Math.round(Math.min(w, h) / 34));
    const lineH = Math.round(font * 1.35);
    const pad = Math.round(font * 0.7);
    const band = pad * 2 + lineH * lines.length;
    ctx.fillStyle = 'rgba(2, 4, 9, 0.66)';
    ctx.fillRect(0, h - band, w, band);
    ctx.fillStyle = '#C9A24B';
    ctx.fillRect(0, h - band, Math.max(4, Math.round(font / 4)), band);

    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.font = `${i === 0 ? 700 : 500} ${font}px Inter, "Segoe UI", Arial, sans-serif`;
      ctx.fillStyle = i === 0 ? '#E3C987' : '#FFFFFF';
      ctx.fillText(line, pad * 1.6, h - band + pad + i * lineH, w - pad * 3);
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
