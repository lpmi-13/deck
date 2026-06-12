export type CardKind = "question" | "answer";
export type PlayMode = "single-device" | "multi-device";

export interface QuestionCard {
  id: string;
  kind: "question";
  text: string;
  pick: number;
  blanks: number;
  deckId: string;
}

export interface AnswerCard {
  id: string;
  kind: "answer";
  text: string;
  deckId: string;
}

export interface DeckDefinition {
  id: string;
  name: string;
  questions: QuestionCard[];
  answers: AnswerCard[];
}

export interface Player {
  id: string;
  name: string;
  score: number;
  hand: AnswerCard[];
}

export interface Submission {
  playerId: string;
  cards: AnswerCard[];
}

export type RoundPhase = "setup" | "submitting" | "revealing" | "roundEnd" | "gameOver";

export interface Round {
  number: number;
  judgeId: string;
  question: QuestionCard;
  activePlayerId: string | null;
  submissions: Submission[];
  revealOrder: number[];
  winnerId: string | null;
}

export interface GameState {
  id: string;
  playMode: PlayMode;
  phase: RoundPhase;
  players: Player[];
  selectedDeckIds: string[];
  questions: QuestionCard[];
  answers: AnswerCard[];
  questionDiscard: QuestionCard[];
  answerDiscard: AnswerCard[];
  round: Round | null;
  targetScore: number;
  handSize: number;
  seed: number;
  createdAt: string;
}

export interface NewGameOptions {
  players: string[];
  decks: DeckDefinition[];
  targetScore: number;
  handSize: number;
  playMode?: PlayMode;
  seed?: number;
}
