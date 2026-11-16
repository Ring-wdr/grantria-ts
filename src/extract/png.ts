// RGBA -> PNG (8-bit RGBA, filter 0, zlib via CompressionStream), the same image tools/grantria_gfx.py write_png makes.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(w: number, h: number, rgba: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const idat = await deflateZlib(raw);
  const chunks: [string, Uint8Array][] = [['IHDR', new Uint8Array(13)], ['IDAT', idat], ['IEND', new Uint8Array(0)]];
  const ihdr = new DataView(chunks[0][1].buffer);
  ihdr.setUint32(0, w); ihdr.setUint32(4, h);
  chunks[0][1].set([8, 6, 0, 0, 0], 8);
  const out = new Uint8Array(8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(out.buffer);
  let p = 8;
  for (const [type, d] of chunks) {
    dv.setUint32(p, d.length);
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i);
    out.set(d, p + 8);
    dv.setUint32(p + 8 + d.length, crc32(out, p + 4, p + 8 + d.length));
    p += 12 + d.length;
  }
  return out;
}
