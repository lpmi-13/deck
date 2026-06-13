// Renders a string as a QR code image (GIF data URL) using the dependency-free
// qrcode-generator. Returns a `data:` URL suitable for an <img src>.

import qrcode from "qrcode-generator";

const CELL_SIZE = 5;
const MARGIN = 4;

/**
 * Build a QR code data URL for `text`. Tries medium error correction first and
 * falls back to low (which holds more data) before giving up, so larger signals
 * still encode. Throws if the text is too large for any QR version.
 */
export function createQrDataUrl(text: string): string {
  for (const errorCorrection of ["M", "L"] as const) {
    try {
      const qr = qrcode(0, errorCorrection);
      qr.addData(text);
      qr.make();
      return qr.createDataURL(CELL_SIZE, MARGIN);
    } catch {
      // Try the next, higher-capacity error-correction level.
    }
  }

  throw new Error("The connection signal is too large to show as a QR code.");
}
