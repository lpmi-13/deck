import type {
  AnswerCard,
  DeckDefinition,
  GameState,
  NewGameOptions,
  Player,
  QuestionCard,
  Round,
  Submission
} from "./types";
import { createSeed, shuffleWithSeed } from "./shuffle";

const DEFAULT_HAND_SIZE = 10;

export function createGame(options: NewGameOptions): GameState {
  const seed = options.seed ?? createSeed();
  const selectedDeckIds = options.decks.map((deck) => deck.id);
  const questions = options.decks.flatMap((deck) => deck.questions);
  const answers = options.decks.flatMap((deck) => deck.answers);
  const shuffledQuestions = shuffleWithSeed(questions, seed);
  const shuffledAnswers = shuffleWithSeed(answers, shuffledQuestions.seed);
  const handSize = Math.max(1, options.handSize || DEFAULT_HAND_SIZE);

  let answerDeck = shuffledAnswers.items;
  const players: Player[] = options.players.map((name, index) => {
    const hand = answerDeck.slice(0, handSize);
    answerDeck = answerDeck.slice(handSize);
    return {
      id: `player-${index + 1}`,
      name,
      score: 0,
      hand
    };
  });

  const state: GameState = {
    id: `game-${Date.now()}`,
    playMode: options.playMode ?? "single-device",
    phase: "setup",
    players,
    selectedDeckIds,
    questions: shuffledQuestions.items,
    answers: answerDeck,
    questionDiscard: [],
    answerDiscard: [],
    round: null,
    targetScore: Math.max(1, options.targetScore),
    handSize,
    seed: shuffledAnswers.seed,
    createdAt: new Date().toISOString()
  };

  return startRound(state);
}

export function startRound(state: GameState): GameState {
  if (state.players.length < 3) {
    throw new Error("At least three players are required.");
  }

  const roundNumber = (state.round?.number ?? 0) + 1;
  const judgeIndex = state.round
    ? (state.players.findIndex((player) => player.id === state.round?.judgeId) + 1) % state.players.length
    : 0;
  const judgeId = state.players[judgeIndex].id;
  const questionResult = drawQuestion(state);
  const activePlayerId = nextSubmittingPlayer(state.players, judgeId, []);

  const round: Round = {
    number: roundNumber,
    judgeId,
    question: questionResult.card,
    activePlayerId,
    submissions: [],
    revealOrder: [],
    winnerId: null
  };

  return {
    ...questionResult.state,
    phase: "submitting",
    round
  };
}

export function submitCards(state: GameState, playerId: string, cardIds: string[]): GameState {
  if (!state.round || state.phase !== "submitting") {
    throw new Error("Cards can only be submitted during the submitting phase.");
  }

  if (playerId === state.round.judgeId) {
    throw new Error("The judge cannot submit cards.");
  }

  if (state.round.activePlayerId !== playerId) {
    throw new Error("It is not this player's turn.");
  }

  if (state.round.submissions.some((submission) => submission.playerId === playerId)) {
    throw new Error("This player has already submitted.");
  }

  if (cardIds.length !== state.round.question.pick) {
    throw new Error(`Select ${state.round.question.pick} card${state.round.question.pick === 1 ? "" : "s"}.`);
  }

  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Each selected card must be unique.");
  }

  const player = findPlayer(state, playerId);
  const selectedCards = cardIds.map((cardId) => {
    const card = player.hand.find((handCard) => handCard.id === cardId);
    if (!card) {
      throw new Error("Selected card is not in this player's hand.");
    }
    return card;
  });

  let workingState: GameState = {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === playerId
        ? {
            ...candidate,
            hand: candidate.hand.filter((card) => !cardIds.includes(card.id))
          }
        : candidate
    ),
    round: {
      ...state.round,
      submissions: [...state.round.submissions, { playerId, cards: selectedCards }]
    }
  };

  workingState = refillHand(workingState, playerId);

  const allSubmitted = workingState.players
    .filter((candidate) => candidate.id !== workingState.round?.judgeId)
    .every((candidate) => workingState.round?.submissions.some((submission) => submission.playerId === candidate.id));

  if (allSubmitted) {
    const revealSeed = shuffleWithSeed(
      workingState.round?.submissions.map((_, index) => index) ?? [],
      workingState.seed
    );
    return {
      ...workingState,
      seed: revealSeed.seed,
      phase: "revealing",
      round: workingState.round
        ? {
            ...workingState.round,
            activePlayerId: null,
            revealOrder: revealSeed.items
          }
        : null
    };
  }

  return {
    ...workingState,
    round: workingState.round
      ? {
          ...workingState.round,
          activePlayerId: nextSubmittingPlayer(
            workingState.players,
            workingState.round.judgeId,
            workingState.round.submissions
          )
        }
      : null
  };
}

export function pickWinner(state: GameState, submissionIndex: number): GameState {
  if (!state.round || state.phase !== "revealing") {
    throw new Error("A winner can only be picked while submissions are revealed.");
  }

  const submission = state.round.submissions[submissionIndex];
  if (!submission) {
    throw new Error("Submission does not exist.");
  }

  const players = state.players.map((player) =>
    player.id === submission.playerId ? { ...player, score: player.score + 1 } : player
  );
  const winner = players.find((player) => player.id === submission.playerId);
  const reachedTarget = Boolean(winner && winner.score >= state.targetScore);
  const usedAnswers = state.round.submissions.flatMap((entry) => entry.cards);

  return {
    ...state,
    phase: reachedTarget ? "gameOver" : "roundEnd",
    players,
    answerDiscard: [...state.answerDiscard, ...usedAnswers],
    round: {
      ...state.round,
      winnerId: submission.playerId
    }
  };
}

export function nextRound(state: GameState): GameState {
  if (state.phase !== "roundEnd") {
    throw new Error("The next round can only start after a winner is picked.");
  }

  return startRound(state);
}

function drawQuestion(state: GameState): { state: GameState; card: QuestionCard } {
  const previousQuestion = state.round?.question;
  const reshuffledQuestions =
    state.questions.length > 0 ? null : shuffleWithSeed(state.questionDiscard, state.seed);
  const availableQuestions = state.questions.length > 0 ? state.questions : reshuffledQuestions?.items ?? [];
  const nextSeed = reshuffledQuestions?.seed ?? state.seed;
  const [card, ...rest] = availableQuestions;

  if (!card) {
    throw new Error("No question cards are available.");
  }

  return {
    card,
    state: {
      ...state,
      seed: nextSeed,
      questions: rest,
      questionDiscard: reshuffledQuestions
        ? previousQuestion
          ? [previousQuestion]
          : []
        : previousQuestion
          ? [...state.questionDiscard, previousQuestion]
          : []
    }
  };
}

function refillHand(state: GameState, playerId: string): GameState {
  const player = findPlayer(state, playerId);
  let answers = state.answers;
  let answerDiscard = state.answerDiscard;
  let seed = state.seed;
  const drawnCards: AnswerCard[] = [];

  while (player.hand.length + drawnCards.length < state.handSize) {
    if (answers.length === 0 && answerDiscard.length > 0) {
      const shuffled = shuffleWithSeed(answerDiscard, seed);
      answers = shuffled.items;
      answerDiscard = [];
      seed = shuffled.seed;
    }

    const [nextCard, ...rest] = answers;
    if (!nextCard) {
      break;
    }

    drawnCards.push(nextCard);
    answers = rest;
  }

  return {
    ...state,
    seed,
    answers,
    answerDiscard,
    players: state.players.map((candidate) =>
      candidate.id === playerId ? { ...candidate, hand: [...candidate.hand, ...drawnCards] } : candidate
    )
  };
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player does not exist.");
  }
  return player;
}

function nextSubmittingPlayer(players: Player[], judgeId: string, submissions: Submission[]): string | null {
  const judgeIndex = Math.max(0, players.findIndex((player) => player.id === judgeId));
  const orderedPlayers = [...players.slice(judgeIndex + 1), ...players.slice(0, judgeIndex)];
  return (
    orderedPlayers.find(
      (player) => player.id !== judgeId && !submissions.some((submission) => submission.playerId === player.id)
    )?.id ?? null
  );
}

export function decksForGame(allDecks: DeckDefinition[], selectedDeckIds: string[]): DeckDefinition[] {
  return allDecks.filter((deck) => selectedDeckIds.includes(deck.id));
}
