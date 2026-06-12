export type ConnectionStatus =
  | "idle"
  | "gathering"
  | "waiting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface PeerMessage<TPayload = unknown> {
  type: string;
  payload: TPayload;
  sentAt: string;
}

export interface MultiplayerTransport {
  readonly status: ConnectionStatus;
  send(message: PeerMessage): void;
  close(): void;
}

export type StatusListener = (status: ConnectionStatus) => void;
export type MessageListener = (message: PeerMessage) => void;

