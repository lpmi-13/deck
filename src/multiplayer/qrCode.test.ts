import { describe, it, expect } from "vitest";
import { createQrDataUrl } from "./qrCode";

describe("qrCode", () => {
  it("renders text as a GIF data URL", () => {
    const url = createQrDataUrl("hello world");
    expect(url.startsWith("data:image/gif")).toBe(true);
    expect(url.length).toBeGreaterThan(50);
  });

  it("encodes a kilobyte-scale payload", () => {
    const url = createQrDataUrl(`C${"a".repeat(900)}`);
    expect(url.startsWith("data:image/gif")).toBe(true);
  });
});
