export type SignalKind = "host-offer" | "guest-answer";

export interface SignalEnvelope {
  version: 1;
  kind: SignalKind;
  description: RTCSessionDescriptionInit;
  createdAt: string;
}

export function createSignal(kind: SignalKind, description: RTCSessionDescriptionInit): SignalEnvelope {
  if (!description.sdp || !description.type) {
    throw new Error("Cannot create a signal without a complete WebRTC description.");
  }

  return {
    version: 1,
    kind,
    description: {
      type: description.type,
      sdp: description.sdp
    },
    createdAt: new Date().toISOString()
  };
}

export function encodeSignal(signal: SignalEnvelope): string {
  const json = JSON.stringify(signal);
  const bytes = new TextEncoder().encode(json);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeSignal(encoded: string): SignalEnvelope {
  const normalized = encoded.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SignalEnvelope>;

  if (parsed.version !== 1 || !parsed.kind || !parsed.description?.sdp || !parsed.description.type) {
    throw new Error("Signal is not a valid multiplayer offer or answer.");
  }

  return parsed as SignalEnvelope;
}

