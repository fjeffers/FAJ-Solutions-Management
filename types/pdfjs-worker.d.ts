// pdf.js ships its worker without type declarations; lib/pdf-view.ts only
// loads it for its side effect (it registers itself on globalThis).
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
