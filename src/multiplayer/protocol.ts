import type { AnswerCard, GameState, Player, QuestionCard, RoundPhase } from "../game/types";
import type { PeerMessage } from "./transport";

export const MULTIPLAYER_PROTOCOL_VERSION = 1;

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  handCount: number;
}

export interface GameSummaryPayload {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  gameId: string;
  phase: RoundPhase;
  players: PublicPlayer[];
  round: {
    number: number;
    judgeId: string;
    activePlayerId: string | null;
    question: QuestionCard;
    submissionsCount: number;
    requiredSubmissions: number;
    winnerId: string | null;
  } | null;
  targetScore: number;
}

export interface PlayerViewPayload extends GameSummaryPayload {
  viewerPlayerId: string;
  hand: AnswerCard[];
  judgeSubmissions: Array<{
    originalIndex: number;
    displayIndex: number;
    cards: AnswerCard[];
  }>;
}

export interface GameStatePayload {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  game: GameState;
}

export interface PlayerViewRequestPayload {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  playerId: string;
}

export interface SubmitCardsPayload {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  playerId: string;
  cardIds: string[];
}

export interface PickWinnerPayload {
  version: typeof MULTIPLAYER_PROTOCOL_VERSION;
  submissionIndex: number;
}

export function createGameSummaryMessage(game: GameState): PeerMessage<GameSummaryPayload> {
  return {
    type: "game-summary",
    payload: createGameSummary(game),
    sentAt: new Date().toISOString()
  };
}

export function createPlayerViewMessage(game: GameState, viewerPlayerId: string): PeerMessage<PlayerViewPayload> {
  const viewer = game.players.find((player) => player.id === viewerPlayerId);
  if (!viewer) {
    throw new Error("Cannot create a player view for an unknown player.");
  }

  return {
    type: "player-view",
    payload: {
      ...createGameSummary(game),
      viewerPlayerId,
      hand: viewer.hand,
      judgeSubmissions: createJudgeSubmissions(game, viewerPlayerId)
    },
    sentAt: new Date().toISOString()
  };
}

export function createGameStateMessage(game: GameState): PeerMessage<GameStatePayload> {
  return {
    type: "game-state",
    payload: {
      version: MULTIPLAYER_PROTOCOL_VERSION,
      game
    },
    sentAt: new Date().toISOString()
  };
}

export function createPlayerViewRequestMessage(playerId: string): PeerMessage<PlayerViewRequestPayload> {
  return {
    type: "player-view-request",
    payload: {
      version: MULTIPLAYER_PROTOCOL_VERSION,
      playerId
    },
    sentAt: new Date().toISOString()
  };
}

export function createSubmitCardsMessage(playerId: string, cardIds: string[]): PeerMessage<SubmitCardsPayload> {
  return {
    type: "submit-cards",
    payload: {
      version: MULTIPLAYER_PROTOCOL_VERSION,
      playerId,
      cardIds
    },
    sentAt: new Date().toISOString()
  };
}

export function createPickWinnerMessage(submissionIndex: number): PeerMessage<PickWinnerPayload> {
  return {
    type: "pick-winner",
    payload: {
      version: MULTIPLAYER_PROTOCOL_VERSION,
      submissionIndex
    },
    sentAt: new Date().toISOString()
  };
}

export function isGameSummaryMessage(message: PeerMessage): message is PeerMessage<GameSummaryPayload> {
  const payload = message.payload as Partial<GameSummaryPayload> | null;
  return (
    message.type === "game-summary" &&
    isVersionedPayload(payload) &&
    typeof payload.gameId === "string" &&
    Array.isArray(payload.players)
  );
}

export function isPlayerViewMessage(message: PeerMessage): message is PeerMessage<PlayerViewPayload> {
  const payload = message.payload as Partial<PlayerViewPayload> | null;
  return (
    message.type === "player-view" &&
    isVersionedPayload(payload) &&
    typeof payload.viewerPlayerId === "string" &&
    Array.isArray(payload.hand) &&
    Array.isArray(payload.judgeSubmissions)
  );
}

export function isGameStateMessage(message: PeerMessage): message is PeerMessage<GameStatePayload> {
  const payload = message.payload as Partial<GameStatePayload> | null;
  return (
    message.type === "game-state" &&
    Boolean(payload) &&
    payload?.version === MULTIPLAYER_PROTOCOL_VERSION &&
    Boolean(payload.game)
  );
}

export function isPlayerViewRequestMessage(
  message: PeerMessage
): message is PeerMessage<PlayerViewRequestPayload> {
  const payload = message.payload as Partial<PlayerViewRequestPayload> | null;
  return message.type === "player-view-request" && isVersionedPayload(payload) && typeof payload.playerId === "string";
}

export function isSubmitCardsMessage(message: PeerMessage): message is PeerMessage<SubmitCardsPayload> {
  const payload = message.payload as Partial<SubmitCardsPayload> | null;
  return (
    message.type === "submit-cards" &&
    isVersionedPayload(payload) &&
    typeof payload.playerId === "string" &&
    Array.isArray(payload.cardIds)
  );
}

export function isPickWinnerMessage(message: PeerMessage): message is PeerMessage<PickWinnerPayload> {
  const payload = message.payload as Partial<PickWinnerPayload> | null;
  return (
    message.type === "pick-winner" &&
    isVersionedPayload(payload) &&
    typeof payload.submissionIndex === "number"
  );
}

function createGameSummary(game: GameState): GameSummaryPayload {
  return {
    version: MULTIPLAYER_PROTOCOL_VERSION,
    gameId: game.id,
    phase: game.phase,
    players: game.players.map(toPublicPlayer),
    round: game.round
      ? {
          number: game.round.number,
          judgeId: game.round.judgeId,
          activePlayerId: game.round.activePlayerId,
          question: game.round.question,
          submissionsCount: game.round.submissions.length,
          requiredSubmissions: Math.max(0, game.players.length - 1),
          winnerId: game.round.winnerId
        }
      : null,
    targetScore: game.targetScore
  };
}

function createJudgeSubmissions(
  game: GameState,
  viewerPlayerId: string
): PlayerViewPayload["judgeSubmissions"] {
  if (!game.round || game.phase !== "revealing" || game.round.judgeId !== viewerPlayerId) {
    return [];
  }

  return game.round.revealOrder.map((originalIndex, displayIndex) => ({
    originalIndex,
    displayIndex,
    cards: game.round?.submissions[originalIndex]?.cards ?? []
  }));
}

function toPublicPlayer(player: Player): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    handCount: player.hand.length
  };
}

function isVersionedPayload(payload: unknown): payload is { version: typeof MULTIPLAYER_PROTOCOL_VERSION } {
  return Boolean(payload) && (payload as { version?: number }).version === MULTIPLAYER_PROTOCOL_VERSION;
}
