import { describe, it, expect } from "vitest";
import { createSignal, decodeSignal, encodeSignal } from "./signal";
import { qrPayloadToSignal, signalToQrPayload } from "./qrSignal";

const SAMPLE_SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=candidate:1 1 udp 2113937151 192.168.1.20 54321 typ host",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:0123456789abcdef0123456789",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF",
  "a=setup:actpass",
  "a=sctp-port:5000"
].join("\r\n");

describe("qrSignal", () => {
  it("round-trips a signal through a compressed QR payload", async () => {
    const signal = encodeSignal(createSignal("host-offer", { type: "offer", sdp: SAMPLE_SDP }));

    const payload = await signalToQrPayload(signal);
    expect(payload.startsWith("C")).toBe(true);

    const restored = await qrPayloadToSignal(payload);
    expect(decodeSignal(restored)).toEqual(decodeSignal(signal));
  });

  it("compresses a repetitive signal below the raw encoded size", async () => {
    const sdp = `${SAMPLE_SDP}\r\na=candidate:${"9".repeat(2000)}`;
    const signal = encodeSignal(createSignal("guest-answer", { type: "answer", sdp }));

    const payload = await signalToQrPayload(signal);
    expect(payload.length).toBeLessThan(signal.length);
  });

  it("rejects a payload with an unknown scheme", async () => {
    await expect(qrPayloadToSignal("Zabcd")).rejects.toThrow();
  });

  it("rejects an empty payload", async () => {
    await expect(qrPayloadToSignal("   ")).rejects.toThrow();
  });
});
