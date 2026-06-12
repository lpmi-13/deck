import { describe, expect, it } from "vitest";
import { createGame, nextRound, pickWinner, submitCards } from "./reducer";
import type { DeckDefinition } from "./types";

const testDeck: DeckDefinition = {
  id: "test",
  name: "Test Deck",
  questions: [
    { id: "q1", kind: "question", text: "Question one ______", pick: 1, blanks: 1, deckId: "test" },
    { id: "q2", kind: "question", text: "Question two ______ and ______", pick: 2, blanks: 2, deckId: "test" },
    { id: "q3", kind: "question", text: "Question three", pick: 1, blanks: 0, deckId: "test" }
  ],
  answers: Array.from({ length: 40 }, (_, index) => ({
    id: `a${index + 1}`,
    kind: "answer",
    text: `Answer ${index + 1}`,
    deckId: "test"
  }))
};

describe("game reducer", () => {
  it("creates a deterministic local game and starts the first round", () => {
    const game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      seed: 1
    });

    expect(game.phase).toBe("submitting");
    expect(game.playMode).toBe("single-device");
    expect(game.players).toHaveLength(3);
    expect(game.players.every((player) => player.hand.length === 5)).toBe(true);
    expect(game.round?.judgeId).toBe("player-1");
    expect(game.round?.activePlayerId).toBe("player-2");
  });

  it("stores multi-device mode when requested", () => {
    const game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      playMode: "multi-device",
      seed: 1
    });

    expect(game.playMode).toBe("multi-device");
  });

  it("submits non-judge cards, reveals anonymous submissions, and scores a round", () => {
    let game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      seed: 1
    });

    const firstSubmitter = game.players.find((player) => player.id === game.round?.activePlayerId);
    expect(firstSubmitter).toBeDefined();
    game = submitCards(game, firstSubmitter!.id, [firstSubmitter!.hand[0].id]);
    expect(game.phase).toBe("submitting");

    const secondSubmitter = game.players.find((player) => player.id === game.round?.activePlayerId);
    expect(secondSubmitter).toBeDefined();
    game = submitCards(game, secondSubmitter!.id, [secondSubmitter!.hand[0].id]);
    expect(game.phase).toBe("revealing");
    expect(game.round?.revealOrder).toHaveLength(2);

    const winningSubmissionIndex = game.round?.revealOrder[0] ?? 0;
    const winnerId = game.round?.submissions[winningSubmissionIndex].playerId;
    game = pickWinner(game, winningSubmissionIndex);

    expect(game.phase).toBe("roundEnd");
    expect(game.players.find((player) => player.id === winnerId)?.score).toBe(1);
    expect(game.answerDiscard).toHaveLength(2);
  });

  it("rotates judges when the next round starts", () => {
    let game = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      seed: 1
    });

    for (const player of game.players.filter((candidate) => candidate.id !== game.round?.judgeId)) {
      game = submitCards(game, player.id, [player.hand[0].id]);
    }
    game = pickWinner(game, game.round?.revealOrder[0] ?? 0);
    game = nextRound(game);

    expect(game.round?.number).toBe(2);
    expect(game.round?.judgeId).toBe("player-2");
    expect(game.round?.activePlayerId).toBe("player-3");
  });

  it("rejects duplicated cards for multi-pick prompts", () => {
    const base = createGame({
      players: ["Ada", "Grace", "Linus"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      seed: 1
    });
    const game = {
      ...base,
      round: base.round
        ? {
            ...base.round,
            question: testDeck.questions[1]
          }
        : null
    };
    const activePlayer = game.players.find((player) => player.id === game.round?.activePlayerId);

    expect(() => submitCards(game, activePlayer!.id, [activePlayer!.hand[0].id, activePlayer!.hand[0].id])).toThrow(
      "unique"
    );
  });

  it("rejects out-of-turn submissions", () => {
    const game = createGame({
      players: ["Ada", "Grace", "Linus", "Margaret"],
      decks: [testDeck],
      targetScore: 3,
      handSize: 5,
      seed: 1
    });
    const outOfTurnPlayer = game.players.find(
      (player) => player.id !== game.round?.judgeId && player.id !== game.round?.activePlayerId
    );

    expect(() => submitCards(game, outOfTurnPlayer!.id, [outOfTurnPlayer!.hand[0].id])).toThrow("turn");
  });
});
