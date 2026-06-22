import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebRtcPeer } from "./webrtc";
import { createSignal, encodeSignal } from "./signal";
import type { ConnectionStatus } from "./transport";

// Minimal RTCPeerConnection stand-in that mirrors the browser's signaling-state
// machine for the transition this suite exercises: a remote answer is only
// accepted while waiting for one ("have-local-offer"), and applying it moves the
// state to "stable". Re-applying then throws, exactly as the browser does.
class FakeRtcPeerConnection {
  signalingState: RTCSignalingState = "have-local-offer";

  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit): Promise<void> => {
    if (description.type === "answer" && this.signalingState !== "have-local-offer") {
      throw new Error(
        "Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': " +
          "Failed to set remote answer sdp: Called in wrong state: stable"
      );
    }
    this.signalingState = "stable";
  });

  addEventListener = vi.fn();
}

const originalRtcPeerConnection = globalThis.RTCPeerConnection;

beforeEach(() => {
  globalThis.RTCPeerConnection = FakeRtcPeerConnection as unknown as typeof RTCPeerConnection;
});

afterEach(() => {
  globalThis.RTCPeerConnection = originalRtcPeerConnection;
});

function createPeer(): { peer: WebRtcPeer; connection: FakeRtcPeerConnection; statuses: ConnectionStatus[] } {
  const statuses: ConnectionStatus[] = [];
  const peer = new WebRtcPeer({ onStatusChange: (status) => statuses.push(status), onMessage: vi.fn() });
  return { peer, connection: peer.connection as unknown as FakeRtcPeerConnection, statuses };
}

const encodedAnswer = encodeSignal(createSignal("guest-answer", { type: "answer", sdp: "v=0\r\ns=answer\r\n" }));

describe("WebRtcPeer.acceptGuestAnswer", () => {
  it("applies a guest answer while the host is waiting for one", async () => {
    const { peer, connection } = createPeer();

    await peer.acceptGuestAnswer(encodedAnswer);

    expect(connection.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(connection.signalingState).toBe("stable");
  });

  it("ignores a repeated answer once the connection has left have-local-offer", async () => {
    const { peer, connection } = createPeer();

    await peer.acceptGuestAnswer(encodedAnswer);
    // Scanning the answer also fills the paste box, so a second tap (or re-scan)
    // re-submits the same answer. The connection is now "stable" — re-applying it
    // would throw "Called in wrong state: stable", so this must be a safe no-op.
    await expect(peer.acceptGuestAnswer(encodedAnswer)).resolves.toBeUndefined();

    expect(connection.setRemoteDescription).toHaveBeenCalledTimes(1);
  });

  it("does not report a connection while applying the answer is still failing", async () => {
    const { peer, connection, statuses } = createPeer();
    connection.setRemoteDescription = vi.fn(async () => {
      throw new Error("network blip");
    });

    await expect(peer.acceptGuestAnswer(encodedAnswer)).rejects.toThrow("network blip");
    // Status must stay on the signalling screen so the host can retry, rather
    // than jumping to "connecting" for an answer that never applied.
    expect(statuses).not.toContain("connecting");
  });

  it("rejects a signal that is not a guest answer", async () => {
    const { peer } = createPeer();
    const hostOffer = encodeSignal(createSignal("host-offer", { type: "offer", sdp: "v=0\r\ns=offer\r\n" }));

    await expect(peer.acceptGuestAnswer(hostOffer)).rejects.toThrow("guest answer");
  });
});
