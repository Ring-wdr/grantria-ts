// Pixel comparison of the WebGL output against a reference PNG rendered by
// tools/grantria_gfx.py map-render (used to verify the port reproduces the original compositor).

export interface CompareResult {
  width: number;
  height: number;
  sizeMatch: boolean;
  total: number;
  /** pixels whose max channel difference exceeds the tolerance */
  diffPixels: number;
  maxDiff: number;
  tolerance: number;
  diffImage: HTMLCanvasElement;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

function pixels(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

export async function compareWithReference(canvas: HTMLCanvasElement, refUrl: string, tolerance = 3): Promise<CompareResult> {
  const ref = await loadImage(refUrl);
  const w = canvas.width, h = canvas.height;
  const a = pixels(canvas, w, h);
  const b = pixels(ref, w, h);
  const diffImage = document.createElement('canvas');
  diffImage.width = w;
  diffImage.height = h;
  const dctx = diffImage.getContext('2d')!;
  const out = dctx.createImageData(w, h);
  let diffPixels = 0, maxDiff = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    maxDiff = Math.max(maxDiff, d);
    const bad = d > tolerance;
    if (bad) diffPixels++;
    // diff view: mismatches in red over a dimmed copy of the reference
    out.data[i] = bad ? 255 : b[i] >> 2;
    out.data[i + 1] = bad ? 0 : b[i + 1] >> 2;
    out.data[i + 2] = bad ? 0 : b[i + 2] >> 2;
    out.data[i + 3] = 255;
  }
  dctx.putImageData(out, 0, 0);
  return {
    width: w, height: h, sizeMatch: ref.naturalWidth === w && ref.naturalHeight === h,
    total: w * h, diffPixels, maxDiff, tolerance, diffImage,
  };
}
