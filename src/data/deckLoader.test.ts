import { describe, expect, it } from "vitest";
import { countBlanks, loadDecks, parseCards } from "./deckLoader";

describe("deck loading", () => {
  it("parses one quoted card per non-empty line", () => {
    expect(parseCards('"First card"\n\n"Second card"')).toEqual(["First card", "Second card"]);
  });

  it("decodes HTML entities used by the sales deck", () => {
    expect(parseCards('"Just once&#44; I want &#34;Congrats on ______&#34;"')).toEqual([
      'Just once, I want "Congrats on ______"'
    ]);
  });

  it("counts blank groups and treats no-blank questions as one-pick prompts", () => {
    expect(countBlanks("______ over ______")).toBe(2);
    expect(countBlanks("What is your secret power?")).toBe(0);

    const [containers] = loadDecks();
    const twoPick = containers.questions.find((card) => card.text.includes("will reimplement"));
    const noBlank = containers.questions.find((card) => card.text === "What's your secret power?");

    expect(twoPick?.pick).toBe(2);
    expect(noBlank?.pick).toBe(1);
  });
});
