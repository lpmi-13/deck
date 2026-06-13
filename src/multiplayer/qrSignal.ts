// QR-friendly signaling codec.
//
// WebRTC offers/answers (with bundled ICE candidates) are a couple of kilobytes
// once base64 encoded — too dense to scan reliably as a QR code. The actual
// payload is JSON, which compresses extremely well, so for the QR path we gzip
// the JSON and re-encode it. The opaque signal string the rest of the app uses
// is left untouched, so this is a pure boundary codec around it.

import { decodeSignal, encodeSignal, type SignalEnvelope } from "./signal";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text: string): Uint8Array {
  const normalized = text.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipeThroughStream(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Copy into a fresh ArrayBuffer-backed view so the chunk satisfies BufferSource.
  void writer.write(new Uint8Array(bytes));
  void writer.close();

  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value as Uint8Array);
    }
  }

  const total = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(bytes, new CompressionStream("gzip"));
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(bytes, new DecompressionStream("gzip"));
}

// Single-character scheme tag so the decoder can tell compressed ("C") payloads
// from the plain ("P") fallback used when CompressionStream is unavailable.
export async function signalToQrPayload(signalString: string): Promise<string> {
  const envelope = decodeSignal(signalString);
  const bytes = new TextEncoder().encode(JSON.stringify(envelope));

  if (typeof CompressionStream !== "undefined") {
    try {
      return `C${base64UrlEncode(await gzip(bytes))}`;
    } catch {
      // Fall through to the uncompressed payload below.
    }
  }

  return `P${base64UrlEncode(bytes)}`;
}

export async function qrPayloadToSignal(payload: string): Promise<string> {
  const trimmed = payload.trim();
  if (!trimmed) {
    throw new Error("The scanned code did not contain a connection signal.");
  }

  const scheme = trimmed[0];
  const bytes = base64UrlDecode(trimmed.slice(1));
  const jsonBytes = scheme === "C" ? await gunzip(bytes) : scheme === "P" ? bytes : null;

  if (!jsonBytes) {
    throw new Error("The scanned code is not a recognized connection signal.");
  }

  const envelope = JSON.parse(new TextDecoder().decode(jsonBytes)) as SignalEnvelope;
  // Re-encode through the canonical encoder so the rest of the app receives the
  // exact signal-string format it expects (and so invalid signals are rejected).
  return encodeSignal(envelope);
}
