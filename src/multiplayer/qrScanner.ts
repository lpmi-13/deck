// Camera-based QR scanner.
//
// Presents a full-screen modal with a live camera preview and decodes QR codes
// from the video frames with jsQR. Resolves with the decoded text, or null if
// the user cancels. Rejects if the camera cannot be started so the caller can
// surface the reason and fall back to copy/paste. The overlay is appended to
// <body>, outside the re-rendered #app subtree.

import jsQR from "jsqr";

export async function scanQrCode(title: string): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access a camera. Use copy and paste instead.");
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "qr-scanner-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title);

  const heading = document.createElement("h2");
  heading.textContent = title;

  const stage = document.createElement("div");
  stage.className = "qr-scanner-stage";

  const video = document.createElement("video");
  video.className = "qr-scanner-video";
  video.setAttribute("playsinline", "true");
  video.muted = true;

  const status = document.createElement("p");
  status.className = "qr-scanner-status";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Point your camera at the code.";

  const actions = document.createElement("div");
  actions.className = "qr-scanner-actions";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary";
  cancelButton.textContent = "Cancel";
  actions.appendChild(cancelButton);

  stage.appendChild(video);
  overlay.append(heading, stage, status, actions);
  document.body.appendChild(overlay);
  cancelButton.focus({ preventScroll: true });

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  return new Promise<string | null>((resolve, reject) => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let settled = false;

    const cleanup = (): void => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      stream?.getTracks().forEach((track) => track.stop());
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.({ preventScroll: true });
    };

    const finish = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    }

    cancelButton.addEventListener("click", () => finish(null));
    document.addEventListener("keydown", onKeyDown);

    const tick = (): void => {
      if (settled) {
        return;
      }

      if (context && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (result?.data) {
          finish(result.data);
          return;
        }
      }

      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (mediaStream) => {
        if (settled) {
          mediaStream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = mediaStream;
        video.srcObject = mediaStream;
        await video.play();
        frame = requestAnimationFrame(tick);
      })
      .catch((error: unknown) => {
        const blocked =
          error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
        fail(
          new Error(
            blocked
              ? "Camera access was blocked. Allow the camera or use copy and paste."
              : "Could not start the camera. Use copy and paste instead."
          )
        );
      });
  });
}
