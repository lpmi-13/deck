import answersText from "../../answers.txt?raw";
import casAnswersText from "../../cas_answers.txt?raw";
import casQuestionsText from "../../cas_questions.txt?raw";
import questionsText from "../../questions.txt?raw";
import type { AnswerCard, DeckDefinition, QuestionCard } from "../game/types";

interface RawDeck {
  id: string;
  name: string;
  questions: string;
  answers: string;
}

const RAW_DECKS: RawDeck[] = [
  {
    id: "containers",
    name: "Cards Against Containers",
    questions: questionsText,
    answers: answersText
  },
  {
    id: "sales",
    name: "Cards Against Sales",
    questions: casQuestionsText,
    answers: casAnswersText
  }
];

export function loadDecks(): DeckDefinition[] {
  return RAW_DECKS.map((deck) => ({
    id: deck.id,
    name: deck.name,
    questions: parseCards(deck.questions).map<QuestionCard>((text, index) => {
      const blanks = countBlanks(text);
      return {
        id: `${deck.id}:question:${index + 1}`,
        kind: "question",
        text,
        blanks,
        pick: Math.max(1, blanks),
        deckId: deck.id
      };
    }),
    answers: parseCards(deck.answers).map<AnswerCard>((text, index) => ({
      id: `${deck.id}:answer:${index + 1}`,
      kind: "answer",
      text,
      deckId: deck.id
    }))
  }));
}

export function parseCards(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => stripOuterQuotes(line))
    .map(decodeHtmlEntities);
}

function stripOuterQuotes(line: string): string {
  if (line.startsWith('"') && line.endsWith('"')) {
    return line.slice(1, -1);
  }

  return line;
}

export function countBlanks(text: string): number {
  return text.match(/_{3,}/g)?.length ?? 0;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, codepoint: string) => String.fromCodePoint(Number(codepoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/,#44;/g, ",");
}
