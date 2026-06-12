import { describe, expect, it } from "vitest";
import { createGame } from "../game/reducer";
import type { DeckDefinition } from "../game/types";
import {
  createGameStateMessage,
  createPlayerViewMessage,
  isGameStateMessage,
  isPlayerViewMessage
} from "./protocol";

const deck: DeckDefinition = {
  id: "protocol-test",
  name: "Protocol Test",
  questions: [{ id: "q1", kind: "question", text: "Prompt ______", pick: 1, blanks: 1, deckId: "protocol-test" }],
  answers: Array.from({ length: 12 }, (_, index) => ({
    id: `a${index + 1}`,
    kind: "answer",
    text: `Answer ${index + 1}`,
    deckId: "protocol-test"
  }))
};

describe("multiplayer protocol", () => {
  it("wraps a game state in a typed protocol message", () => {
    const game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [deck],
      targetScore: 3,
      handSize: 3,
      seed: 1
    });
    const message = createGameStateMessage(game);

    expect(isGameStateMessage(message)).toBe(true);
    expect(message.payload.game.id).toBe(game.id);
  });

  it("creates a redacted player view with only the viewer hand", () => {
    const game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [deck],
      targetScore: 3,
      handSize: 3,
      seed: 1
    });
    const message = createPlayerViewMessage(game, "player-2");

    expect(isPlayerViewMessage(message)).toBe(true);
    expect(message.payload.viewerPlayerId).toBe("player-2");
    expect(message.payload.hand).toEqual(game.players[1].hand);
    expect(message.payload.players.map((player) => player.handCount)).toEqual([3, 3, 3]);
    expect(JSON.stringify(message.payload)).not.toContain(game.players[0].hand[0].id);
  });
});
