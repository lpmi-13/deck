import { describe, expect, it } from "vitest";
import { createSignal, decodeSignal, encodeSignal } from "./signal";

describe("signal codec", () => {
  it("round-trips a WebRTC signal envelope", () => {
    const signal = createSignal("host-offer", {
      type: "offer",
      sdp: "v=0\r\ns=Cards Against Containers\r\n"
    });

    expect(decodeSignal(encodeSignal(signal))).toEqual(signal);
  });

  it("rejects malformed signal data", () => {
    expect(() => decodeSignal("not a signal")).toThrow();
  });
});
