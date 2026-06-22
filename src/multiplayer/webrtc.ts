import type {
  ConnectionStatus,
  MessageListener,
  MultiplayerTransport,
  PeerMessage,
  StatusListener
} from "./transport";
import { createSignal, decodeSignal, encodeSignal } from "./signal";

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

interface WebRtcPeerOptions {
  onStatusChange: StatusListener;
  onMessage: MessageListener;
  rtcConfig?: RTCConfiguration;
}

export class WebRtcPeer implements MultiplayerTransport {
  readonly connection: RTCPeerConnection;
  private channel: RTCDataChannel | null = null;
  private statusValue: ConnectionStatus = "idle";
  private readonly onStatusChange: StatusListener;
  private readonly onMessage: MessageListener;

  constructor(options: WebRtcPeerOptions) {
    this.connection = new RTCPeerConnection(options.rtcConfig ?? DEFAULT_RTC_CONFIG);
    this.onStatusChange = options.onStatusChange;
    this.onMessage = options.onMessage;
    this.connection.addEventListener("connectionstatechange", () => {
      this.setStatus(mapConnectionStatus(this.connection.connectionState));
    });
    this.connection.addEventListener("datachannel", (event) => {
      this.attachChannel(event.channel);
    });
  }

  get status(): ConnectionStatus {
    return this.statusValue;
  }

  async createHostOffer(): Promise<string> {
    this.attachChannel(this.connection.createDataChannel("cards-against-containers"));
    this.setStatus("gathering");
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.connection);

    if (!this.connection.localDescription) {
      throw new Error("Host offer was not created.");
    }

    this.setStatus("waiting");
    return encodeSignal(createSignal("host-offer", this.connection.localDescription));
  }

  async acceptGuestAnswer(encodedAnswer: string): Promise<void> {
    const answer = decodeSignal(encodedAnswer);
    if (answer.kind !== "guest-answer") {
      throw new Error("Paste a guest answer signal.");
    }

    // A remote answer is only valid while we are still waiting for one
    // ("have-local-offer"). Once it has been applied the state moves to
    // "stable", so re-applying it throws "Called in wrong state: stable".
    // This happens easily on the host card, where scanning an answer also
    // fills the paste box: tapping "Accept Pasted Answer" (or scanning again)
    // would otherwise apply the same answer twice. Treat the repeat as a
    // no-op so the established connection is left intact.
    if (this.connection.signalingState !== "have-local-offer") {
      return;
    }

    this.setStatus("connecting");
    await this.connection.setRemoteDescription(answer.description);
  }

  async createGuestAnswer(encodedOffer: string): Promise<string> {
    const offer = decodeSignal(encodedOffer);
    if (offer.kind !== "host-offer") {
      throw new Error("Paste a host offer signal.");
    }

    this.setStatus("connecting");
    await this.connection.setRemoteDescription(offer.description);
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    this.setStatus("gathering");
    await waitForIceGatheringComplete(this.connection);

    if (!this.connection.localDescription) {
      throw new Error("Guest answer was not created.");
    }

    this.setStatus("waiting");
    return encodeSignal(createSignal("guest-answer", this.connection.localDescription));
  }

  send(message: PeerMessage): void {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("Peer connection is not open.");
    }

    this.channel.send(JSON.stringify(message));
  }

  close(): void {
    this.channel?.close();
    this.connection.close();
    this.setStatus("closed");
  }

  private attachChannel(channel: RTCDataChannel): void {
    this.channel = channel;
    this.channel.addEventListener("open", () => {
      this.setStatus("connected");
    });
    this.channel.addEventListener("close", () => {
      this.setStatus("closed");
    });
    this.channel.addEventListener("message", (event) => {
      this.onMessage(parsePeerMessage(event.data));
    });
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusValue = status;
    this.onStatusChange(status);
  }
}

function waitForIceGatheringComplete(connection: RTCPeerConnection, timeoutMs = 8000): Promise<void> {
  if (connection.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(done, timeoutMs);

    function done(): void {
      window.clearTimeout(timeoutId);
      connection.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    }

    function handleStateChange(): void {
      if (connection.iceGatheringState === "complete") {
        done();
      }
    }

    connection.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

function parsePeerMessage(data: unknown): PeerMessage {
  if (typeof data !== "string") {
    return { type: "raw", payload: data, sentAt: new Date().toISOString() };
  }

  try {
    const parsed = JSON.parse(data) as PeerMessage;
    if (typeof parsed.type === "string" && typeof parsed.sentAt === "string") {
      return parsed;
    }
  } catch {
    return { type: "text", payload: data, sentAt: new Date().toISOString() };
  }

  return { type: "text", payload: data, sentAt: new Date().toISOString() };
}

function mapConnectionStatus(status: RTCPeerConnectionState): ConnectionStatus {
  if (status === "new") {
    return "idle";
  }

  if (status === "connecting") {
    return "connecting";
  }

  if (status === "connected") {
    return "connected";
  }

  if (status === "disconnected") {
    return "disconnected";
  }

  if (status === "failed") {
    return "failed";
  }

  return "closed";
}

