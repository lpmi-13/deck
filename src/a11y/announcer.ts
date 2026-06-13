// A persistent live-region announcer.
//
// The app re-renders by replacing `#app`'s innerHTML on every state change, which
// destroys and recreates any live region inside it. Assistive technology only
// reliably announces changes to a region that stays in the DOM, so these regions
// are created once and appended to <body>, outside the re-rendered subtree.

type Politeness = "polite" | "assertive";

const regions: Partial<Record<Politeness, HTMLElement>> = {};

function ensureRegion(politeness: Politeness): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const existing = regions[politeness];
  if (existing) {
    return existing;
  }

  const region = document.createElement("div");
  region.className = "visually-hidden";
  region.setAttribute("aria-live", politeness);
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("role", politeness === "assertive" ? "alert" : "status");
  document.body.appendChild(region);
  regions[politeness] = region;
  return region;
}

/**
 * Announce a message to screen readers without moving focus or changing the
 * visible UI. Use `assertive` for messages that should interrupt (errors);
 * the default polite channel is for status updates.
 */
export function announce(message: string, options: { assertive?: boolean } = {}): void {
  const text = message.trim();
  if (!text) {
    return;
  }

  const region = ensureRegion(options.assertive ? "assertive" : "polite");
  if (!region) {
    return;
  }

  // Clearing first guarantees assistive tech re-announces an identical message.
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = text;
  }, 50);
}
