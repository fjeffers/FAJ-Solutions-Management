// Barcode reading, in order of what actually works on a phone in a van.
//
// 1. A LIVE camera stream, scanned frame by frame until it locks on. This is
//    what "point the camera at it" means, it runs entirely on the phone, and
//    it costs nothing. Android Chrome has had it for years.
// 2. A still photo, read the same way on-device. Weaker — one frame, one shot
//    at focus — but it is there when the live view is not.
// 3. The photo sent up to be read by AI. Last, because it needs a key set up,
//    costs money per scan, and is the slowest of the three.
//
// Anything unsupported falls through quietly to typing the number in, which
// always works.

type DetectedBarcode = { rawValue?: string };
type BarcodeDetectorLike = { detect: (s: CanvasImageSource | ImageBitmapSource) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

// The symbologies actually printed on trade stock: retail UPC/EAN on boxes,
// Code 128/39 on supply-house and warehouse labels, QR on newer kit.
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

/** Can this browser scan a live camera stream? */
export function supportsLiveScan(): boolean {
  return (
    detectorCtor() !== null &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function makeDetector(): BarcodeDetectorLike | null {
  const Ctor = detectorCtor();
  if (!Ctor) return null;
  try {
    return new Ctor({ formats: FORMATS });
  } catch {
    // Some builds reject the format list but work with the defaults.
    try { return new Ctor(); } catch { return null; }
  }
}

/** Read a barcode off a still photo, on the phone. Null if it cannot. */
export async function readBarcodeFromFile(file: File): Promise<string | null> {
  const detector = makeDetector();
  if (!detector || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const found = await detector.detect(bitmap);
    return found?.[0]?.rawValue?.trim() || null;
  } catch {
    return null;
  }
}

export type LiveScan = { stop: () => void };

/**
 * Open the back camera and scan until a barcode is read.
 *
 * Returns a handle whose stop() releases the camera — it MUST be called, on
 * success, on failure and on unmount alike. A camera light left on after the
 * panel is closed is the kind of thing that gets an app deleted.
 */
export async function startLiveScan(
  video: HTMLVideoElement,
  onFound: (code: string) => void,
  onError: (message: string) => void,
): Promise<LiveScan> {
  const detector = makeDetector();
  if (!detector) {
    onError('This browser cannot scan barcodes — type the number in, or use the photo option.');
    return { stop: () => {} };
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    onError(
      name === 'NotAllowedError'
        ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or type the number in.'
        : 'Could not open the camera — type the number in instead.',
    );
    return { stop: () => {} };
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    try { video.srcObject = null; } catch { /* already torn down */ }
  };

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  try {
    await video.play();
  } catch {
    stop();
    onError('Could not start the camera preview — type the number in instead.');
    return { stop: () => {} };
  }

  // Poll rather than chase every frame: four looks a second finds a barcode as
  // fast as a person can hold the phone still, and leaves the battery alone.
  const tick = async () => {
    if (stopped) return;
    try {
      const found = await detector.detect(video);
      const code = found?.[0]?.rawValue?.trim();
      if (code) {
        stop();
        onFound(code);
        return;
      }
    } catch {
      // A frame that cannot be decoded is the normal case, not an error.
    }
    if (!stopped) timer = setTimeout(tick, 250);
  };
  timer = setTimeout(tick, 250);

  return { stop };
}
