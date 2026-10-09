import { parseDoc, serialiseDoc, type Doc } from './custom';
import { snapshotSpecs, type Store } from './store';

/**
 * Share links carry the whole document in the URL hash:
 *   #g1=<base64url(JSON)>      plain
 *   #g1z=<base64url(deflate-raw(JSON))>   compressed (when CompressionStream exists and it is actually smaller)
 * The JSON is exactly `serialiseDoc` (custom.ts: the CS-slot node schema, fx, wallpaper target), so any field another
 * part of the app adds to the serialiser / parser travels automatically. Decoding goes through `parseDoc`.
 */
export const SHARE_RE = /^#g1(z?)=([A-Za-z0-9_-]+)$/;
/** Longest hash we will even try to decode, and the largest JSON we will inflate (zip-bomb guard). */
const MAX_HASH = 200_000;
const MAX_JSON = 400_000;

function toB64u(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64u(text: string): Uint8Array {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as BufferSource).catch(() => {});
  void w.close().catch(() => {});
  const r = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void r.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** `#g1=…` / `#g1z=…` for the current document. */
export async function encodeShare(store: Store): Promise<string> {
  const json = JSON.stringify(serialiseDoc(snapshotSpecs(store), store.fx, { wp: store.wallpaper, cs: store.wpCustom }));
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const z = await pipe(raw, new CompressionStream('deflate-raw'), MAX_JSON);
      if (z.length < raw.length) return `#g1z=${toB64u(z)}`;
    } catch {
      /* fall through to the plain form */
    }
  }
  return `#g1=${toB64u(raw)}`;
}

/** Whether a hash looks like one of ours (valid or not); anything else (#top, #spec) is left alone. */
export const isShareHash = (hash: string): boolean => /^#g1z?=/.test(hash);

/** Decode a share hash; null for anything malformed, oversized or failing validation (never throws). */
export async function decodeShare(hash: string): Promise<Doc | null> {
  const m = SHARE_RE.exec(hash);
  if (!m || hash.length > MAX_HASH) return null;
  try {
    let bytes = fromB64u(m[2]);
    if (m[1] === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON);
    } else if (bytes.length > MAX_JSON) {
      return null;
    }
    return parseDoc(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/** The full link for the current document. */
export async function shareUrl(store: Store): Promise<string> {
  return `${location.origin}${location.pathname}${location.search}${await encodeShare(store)}`;
}
