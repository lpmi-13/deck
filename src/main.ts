import "./style.css";
import { loadDecks } from "./data/deckLoader";
import { createGame, decksForGame, nextRound, pickWinner, submitCards } from "./game/reducer";
import type { AnswerCard, DeckDefinition, GameState, Player, PlayMode, Submission } from "./game/types";
import {
  createGameSummaryMessage,
  createGameStateMessage,
  createPickWinnerMessage,
  createPlayerViewMessage,
  createPlayerViewRequestMessage,
  createSubmitCardsMessage,
  isGameStateMessage,
  isGameSummaryMessage,
  isPickWinnerMessage,
  isPlayerViewMessage,
  isPlayerViewRequestMessage,
  isSubmitCardsMessage,
  type GameSummaryPayload,
  type PlayerViewPayload
} from "./multiplayer/protocol";
import { WebRtcPeer } from "./multiplayer/webrtc";
import type { ConnectionStatus, PeerMessage } from "./multiplayer/transport";

const STORAGE_KEY = "cards-against-containers.game";
const decks = loadDecks();
const logoUrl = new URL("../sysdig.png", import.meta.url).href;
const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root was not found.");
}

const app = appRoot;

interface DraftPlayer {
  id: string;
  name: string;
}

interface UiState {
  game: GameState | null;
  setupPlayers: DraftPlayer[];
  selectedDeckIds: string[];
  targetScore: number;
  playMode: PlayMode;
  visiblePlayerId: string | null;
  selectedCardIds: string[];
  remoteSelectedCardIds: string[];
  privacyGateOpen: boolean;
  error: string | null;
  multiplayer: MultiplayerUiState;
}

interface MultiplayerUiState {
  open: boolean;
  role: "host" | "guest";
  status: ConnectionStatus;
  session: WebRtcPeer | null;
  localSignal: string;
  remoteSignalInput: string;
  outboundText: string;
  log: string[];
  remoteGame: GameState | null;
  remoteSummary: GameSummaryPayload | null;
  remotePlayerView: PlayerViewPayload | null;
  remotePlayerId: string;
  peerPlayerId: string | null;
}

const ui: UiState = {
  game: restoreGame(),
  setupPlayers: [
    { id: "draft-1", name: "Player 1" },
    { id: "draft-2", name: "Player 2" },
    { id: "draft-3", name: "Player 3" }
  ],
  selectedDeckIds: decks.map((deck) => deck.id),
  targetScore: 5,
  playMode: "single-device",
  visiblePlayerId: null,
  selectedCardIds: [],
  remoteSelectedCardIds: [],
  privacyGateOpen: false,
  error: null,
  multiplayer: {
    open: false,
    role: "host",
    status: "idle",
    session: null,
    localSignal: "",
    remoteSignalInput: "",
    outboundText: "",
    log: [],
    remoteGame: null,
    remoteSummary: null,
    remotePlayerView: null,
    remotePlayerId: "",
    peerPlayerId: null
  }
};

syncUiToGame();
render();

function render(): void {
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="${logoUrl}" alt="" />
          <div>
            <h1>Cards Against Containers</h1>
            <p>Static pass-and-play prototype</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="secondary" data-action="toggle-multiplayer" type="button">
            ${ui.multiplayer.open ? "Hide P2P" : "P2P"}
          </button>
          ${ui.game ? '<button class="secondary" data-action="show-setup" type="button">New Game</button>' : ""}
        </div>
      </header>
      ${ui.error ? `<div class="notice error">${escapeHtml(ui.error)}</div>` : ""}
      ${ui.game ? renderGame(ui.game) : renderSetup()}
      ${ui.multiplayer.open ? renderMultiplayerPanel() : ""}
    </main>
  `;

  bindEvents();
}

function renderSetup(): string {
  const totalQuestions = selectedDecks().reduce((sum, deck) => sum + deck.questions.length, 0);
  const totalAnswers = selectedDecks().reduce((sum, deck) => sum + deck.answers.length, 0);

  return `
    <section class="setup-layout">
      <form class="setup-panel" data-form="setup">
        <div class="section-heading">
          <h2>Game Setup</h2>
          <p>Add players, choose decks, and choose how people will play.</p>
        </div>

        <fieldset>
          <legend>Play mode</legend>
          <div class="mode-options">
            ${renderModeOption("single-device", "Single device", "Pass the same screen around with privacy gates.")}
            ${renderModeOption("multi-device", "Multi-device", "Use this browser as the host and connect guests over WebRTC.")}
          </div>
        </fieldset>

        <fieldset>
          <legend>Players</legend>
          <div class="player-list">
            ${ui.setupPlayers.map(renderDraftPlayer).join("")}
          </div>
          <button class="secondary" data-action="add-player" type="button">Add Player</button>
        </fieldset>

        <fieldset>
          <legend>Decks</legend>
          <div class="deck-options">
            ${decks.map(renderDeckOption).join("")}
          </div>
        </fieldset>

        <label class="field compact-field">
          <span>Winning score</span>
          <input name="targetScore" type="number" min="1" max="25" value="${ui.targetScore}" />
        </label>

        <button class="primary" type="submit">Start Game</button>
      </form>

      <aside class="deck-summary">
        <div>
          <span class="metric">${totalQuestions}</span>
          <span>Questions</span>
        </div>
        <div>
          <span class="metric">${totalAnswers}</span>
          <span>Answers</span>
        </div>
        <div>
          <span class="metric">${ui.setupPlayers.length}</span>
          <span>Players</span>
        </div>
      </aside>
    </section>
  `;
}

function renderDraftPlayer(player: DraftPlayer, index: number): string {
  const canRemove = ui.setupPlayers.length > 3;
  return `
    <div class="draft-player">
      <label class="field">
        <span>Player ${index + 1}</span>
        <input name="playerName" data-player-id="${player.id}" value="${escapeAttribute(player.name)}" />
      </label>
      <button
        class="icon-button"
        data-action="remove-player"
        data-player-id="${player.id}"
        type="button"
        title="Remove player"
        ${canRemove ? "" : "disabled"}
      >
        &times;
      </button>
    </div>
  `;
}

function renderDeckOption(deck: DeckDefinition): string {
  const checked = ui.selectedDeckIds.includes(deck.id);
  return `
    <label class="deck-option">
      <input type="checkbox" name="deck" value="${deck.id}" ${checked ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(deck.name)}</strong>
        <small>${deck.questions.length} questions, ${deck.answers.length} answers</small>
      </span>
    </label>
  `;
}

function renderModeOption(mode: PlayMode, label: string, description: string): string {
  const checked = ui.playMode === mode;
  return `
    <label class="mode-option ${checked ? "is-selected" : ""}">
      <input type="radio" name="playMode" value="${mode}" ${checked ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(label)}</strong>
        <small>${escapeHtml(description)}</small>
      </span>
    </label>
  `;
}

function renderGame(game: GameState): string {
  if (!game.round) {
    return "";
  }

  const judge = playerById(game, game.round.judgeId);
  return `
    <section class="game-layout">
      <aside class="scoreboard">
        <div class="section-heading">
          <h2>Round ${game.round.number}</h2>
          <p>Judge: ${escapeHtml(judge.name)}</p>
        </div>
        <div class="score-list">
          ${game.players.map((player) => renderScore(player, game.round?.judgeId ?? "")).join("")}
        </div>
        <div class="deck-counts">
          <span>${game.questions.length} questions left</span>
          <span>${game.answers.length} answers left</span>
        </div>
      </aside>

      <section class="table">
        ${renderQuestion(game)}
        ${renderPhase(game)}
      </section>
    </section>
  `;
}

function renderScore(player: Player, judgeId: string): string {
  return `
    <div class="score-row ${player.id === judgeId ? "is-judge" : ""}">
      <span>${escapeHtml(player.name)}</span>
      <strong>${player.score}</strong>
    </div>
  `;
}

function renderQuestion(game: GameState): string {
  const question = game.round?.question;
  if (!question) {
    return "";
  }

  return `
    <article class="question-card">
      <div class="card-label">Question</div>
      <p>${escapeHtml(question.text)}</p>
      <span class="pick-count">Pick ${question.pick}</span>
    </article>
  `;
}

function renderPhase(game: GameState): string {
  if (!game.round) {
    return "";
  }

  if (game.phase === "submitting") {
    return renderSubmitting(game);
  }

  if (game.phase === "revealing") {
    return renderRevealing(game);
  }

  if (game.phase === "roundEnd") {
    return renderRoundEnd(game);
  }

  if (game.phase === "gameOver") {
    return renderGameOver(game);
  }

  return "";
}

function renderSubmitting(game: GameState): string {
  const activePlayer = game.round?.activePlayerId ? playerById(game, game.round.activePlayerId) : null;
  const judge = game.round ? playerById(game, game.round.judgeId) : null;

  if (!activePlayer || !game.round || !judge) {
    return "";
  }

  const submittedCount = game.round.submissions.length;
  const neededCount = game.players.length - 1;

  if (!ui.privacyGateOpen || ui.visiblePlayerId !== activePlayer.id) {
    return `
      <div class="phase-panel">
        <div class="section-heading">
          <h2>${escapeHtml(activePlayer.name)}'s Turn</h2>
          <p>${submittedCount} of ${neededCount} players have submitted. Pass the device before revealing the hand.</p>
        </div>
        <button class="primary" data-action="open-hand" data-player-id="${activePlayer.id}" type="button">Show Hand</button>
      </div>
    `;
  }

  return `
    <form class="phase-panel" data-form="submit-cards" data-player-id="${activePlayer.id}">
      <div class="section-heading">
        <h2>${escapeHtml(activePlayer.name)}, choose ${game.round.question.pick}</h2>
        <p>${escapeHtml(judge.name)} is judging this round.</p>
      </div>
      <div class="hand-grid">
        ${activePlayer.hand.map((card) => renderHandCard(card, game.round?.question.pick ?? 1)).join("")}
      </div>
      <div class="submit-bar">
        <button class="secondary" data-action="hide-hand" type="button">Hide Hand</button>
        <button class="primary" type="submit">Submit Selected</button>
      </div>
    </form>
  `;
}

function renderHandCard(card: AnswerCard, pick: number): string {
  const selected = ui.selectedCardIds.includes(card.id);
  const inputType = pick === 1 ? "radio" : "checkbox";
  return `
    <label class="answer-card ${selected ? "is-selected" : ""}">
      <input
        type="${inputType}"
        name="selectedCard"
        value="${card.id}"
        ${selected ? "checked" : ""}
      />
      <span>${escapeHtml(card.text)}</span>
    </label>
  `;
}

function renderRevealing(game: GameState): string {
  if (!game.round) {
    return "";
  }

  const judge = playerById(game, game.round.judgeId);
  const orderedSubmissions = game.round.revealOrder.map((index) => ({
    originalIndex: index,
    submission: game.round?.submissions[index]
  }));

  return `
    <div class="phase-panel">
      <div class="section-heading">
        <h2>${escapeHtml(judge.name)} Picks a Winner</h2>
        <p>Submissions are anonymous until the winner is selected.</p>
      </div>
      <div class="submission-grid">
        ${orderedSubmissions.map((entry, index) => renderSubmission(entry.submission, entry.originalIndex, index)).join("")}
      </div>
    </div>
  `;
}

function renderSubmission(submission: Submission | undefined, originalIndex: number, displayIndex: number): string {
  if (!submission) {
    return "";
  }

  return `
    <article class="submission-card">
      <div class="card-label">Submission ${displayIndex + 1}</div>
      <div class="submission-answers">
        ${submission.cards.map((card) => `<p>${escapeHtml(card.text)}</p>`).join("")}
      </div>
      <button class="primary" data-action="pick-winner" data-submission-index="${originalIndex}" type="button">Pick Winner</button>
    </article>
  `;
}

function renderRoundEnd(game: GameState): string {
  if (!game.round?.winnerId) {
    return "";
  }

  const winner = playerById(game, game.round.winnerId);
  return `
    <div class="phase-panel">
      <div class="section-heading">
        <h2>${escapeHtml(winner.name)} Wins the Round</h2>
        <p>First to ${game.targetScore} wins the game.</p>
      </div>
      <button class="primary" data-action="next-round" type="button">Next Round</button>
    </div>
  `;
}

function renderGameOver(game: GameState): string {
  const winner = [...game.players].sort((left, right) => right.score - left.score)[0];
  return `
    <div class="phase-panel">
      <div class="section-heading">
        <h2>${escapeHtml(winner.name)} Wins</h2>
        <p>Final score: ${winner.score}</p>
      </div>
      <button class="primary" data-action="show-setup" type="button">Play Again</button>
    </div>
  `;
}

function renderMultiplayerPanel(): string {
  return `
    <section class="multiplayer-panel">
      <div class="section-heading">
        <h2>Peer Connection</h2>
        <p>Status: <strong class="status-pill status-${ui.multiplayer.status}">${ui.multiplayer.status}</strong></p>
      </div>

      <div class="role-tabs" role="tablist">
        <button
          class="secondary ${ui.multiplayer.role === "host" ? "is-active" : ""}"
          data-action="set-multiplayer-role"
          data-role="host"
          type="button"
        >
          Host
        </button>
        <button
          class="secondary ${ui.multiplayer.role === "guest" ? "is-active" : ""}"
          data-action="set-multiplayer-role"
          data-role="guest"
          type="button"
        >
          Guest
        </button>
      </div>

      ${ui.multiplayer.role === "host" ? renderHostSignaling() : renderGuestSignaling()}
      ${renderPeerMessenger()}
      ${ui.multiplayer.remoteGame ? renderRemoteGameSnapshot(ui.multiplayer.remoteGame) : ""}
    </section>
  `;
}

function renderHostSignaling(): string {
  return `
    <div class="signal-grid">
      <div class="signal-field">
        <div class="field-label">Host offer</div>
        <textarea readonly name="localSignal">${escapeHtml(ui.multiplayer.localSignal)}</textarea>
        <div class="button-row">
          <button class="primary" data-action="create-host-offer" type="button">Create Offer</button>
          <button class="secondary" data-action="copy-local-signal" type="button" ${ui.multiplayer.localSignal ? "" : "disabled"}>Copy</button>
        </div>
      </div>
      <div class="signal-field">
        <div class="field-label">Guest answer</div>
        <textarea name="remoteSignal">${escapeHtml(ui.multiplayer.remoteSignalInput)}</textarea>
        <button class="primary" data-action="accept-guest-answer" type="button">Accept Answer</button>
      </div>
    </div>
  `;
}

function renderGuestSignaling(): string {
  return `
    <div class="signal-grid">
      <div class="signal-field">
        <div class="field-label">Host offer</div>
        <textarea name="remoteSignal">${escapeHtml(ui.multiplayer.remoteSignalInput)}</textarea>
        <button class="primary" data-action="create-guest-answer" type="button">Create Answer</button>
      </div>
      <div class="signal-field">
        <div class="field-label">Guest answer</div>
        <textarea readonly name="localSignal">${escapeHtml(ui.multiplayer.localSignal)}</textarea>
        <button class="secondary" data-action="copy-local-signal" type="button" ${ui.multiplayer.localSignal ? "" : "disabled"}>Copy</button>
      </div>
    </div>
  `;
}

function renderPeerMessenger(): string {
  return `
    <form class="peer-messenger" data-form="peer-send">
      <label class="field">
        <span>Message</span>
        <input name="peerMessage" value="${escapeAttribute(ui.multiplayer.outboundText)}" />
      </label>
      <div class="button-row">
        <button class="primary" type="submit" ${ui.multiplayer.status === "connected" ? "" : "disabled"}>Send</button>
        <button class="secondary" data-action="broadcast-game" type="button" ${ui.multiplayer.status === "connected" && ui.game ? "" : "disabled"}>Broadcast Game</button>
        <button class="secondary" data-action="close-peer" type="button" ${ui.multiplayer.session ? "" : "disabled"}>Close</button>
      </div>
      <div class="message-log" aria-live="polite">
        ${ui.multiplayer.log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")}
      </div>
    </form>
  `;
}

function renderRemoteGameSnapshot(game: GameState): string {
  const judge = game.round ? game.players.find((player) => player.id === game.round?.judgeId) : null;
  return `
    <div class="remote-game">
      <div class="field-label">Received game</div>
      <div class="remote-game-grid">
        <span>Phase</span>
        <strong>${escapeHtml(game.phase)}</strong>
        <span>Round</span>
        <strong>${game.round?.number ?? 0}</strong>
        <span>Judge</span>
        <strong>${escapeHtml(judge?.name ?? "None")}</strong>
      </div>
    </div>
  `;
}

function bindEvents(): void {
  app.querySelector<HTMLFormElement>('[data-form="setup"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    runAction(() => {
      const names = ui.setupPlayers.map((player) => player.name.trim()).filter(Boolean);
      const selected = selectedDecks();

      if (names.length < 3) {
        throw new Error("Add at least three players.");
      }

      if (selected.length === 0) {
        throw new Error("Select at least one deck.");
      }

      ui.game = createGame({
        players: names,
        decks: selected,
        targetScore: ui.targetScore,
        handSize: 10,
        playMode: ui.playMode
      });
      if (ui.playMode === "multi-device") {
        ui.multiplayer.open = true;
        ui.multiplayer.role = "host";
      }
      syncUiToGame();
      saveGame();
    });
  });

  app.querySelector<HTMLFormElement>('[data-form="submit-cards"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const playerId = form.dataset.playerId;
    if (!playerId || !ui.game) {
      return;
    }

    runAction(() => {
      ui.game = submitCards(ui.game as GameState, playerId, ui.selectedCardIds);
      ui.privacyGateOpen = false;
      ui.selectedCardIds = [];
      syncUiToGame();
      saveGame();
    });
  });

  app.querySelector<HTMLFormElement>('[data-form="peer-send"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    runAction(() => {
      const text = ui.multiplayer.outboundText.trim();
      if (!text) {
        return;
      }

      sendPeerMessage({ type: "chat", payload: text, sentAt: new Date().toISOString() });
      ui.multiplayer.log = [`You: ${text}`, ...ui.multiplayer.log].slice(0, 20);
      ui.multiplayer.outboundText = "";
    });
  });

  app.querySelectorAll<HTMLInputElement>('input[name="playerName"]').forEach((input) => {
    input.addEventListener("input", () => {
      const playerId = input.dataset.playerId;
      const player = ui.setupPlayers.find((candidate) => candidate.id === playerId);
      if (player) {
        player.name = input.value;
      }
    });
  });

  app.querySelector<HTMLInputElement>('input[name="targetScore"]')?.addEventListener("input", (event) => {
    ui.targetScore = Number((event.currentTarget as HTMLInputElement).value) || 5;
  });

  app.querySelectorAll<HTMLInputElement>('input[name="playMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked && (input.value === "single-device" || input.value === "multi-device")) {
        ui.playMode = input.value;
        render();
      }
    });
  });

  app.querySelectorAll<HTMLInputElement>('input[name="deck"]').forEach((input) => {
    input.addEventListener("change", () => {
      ui.selectedDeckIds = Array.from(app.querySelectorAll<HTMLInputElement>('input[name="deck"]:checked')).map(
        (element) => element.value
      );
      render();
    });
  });

  app.querySelectorAll<HTMLInputElement>('input[name="selectedCard"]').forEach((input) => {
    input.addEventListener("change", () => {
      ui.selectedCardIds = Array.from(app.querySelectorAll<HTMLInputElement>('input[name="selectedCard"]:checked')).map(
        (element) => element.value
      );
      render();
    });
  });

  app.querySelector<HTMLTextAreaElement>('textarea[name="remoteSignal"]')?.addEventListener("input", (event) => {
    ui.multiplayer.remoteSignalInput = (event.currentTarget as HTMLTextAreaElement).value;
  });

  app.querySelector<HTMLInputElement>('input[name="peerMessage"]')?.addEventListener("input", (event) => {
    ui.multiplayer.outboundText = (event.currentTarget as HTMLInputElement).value;
  });

  app.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element));
  });
}

function handleAction(element: HTMLElement): void {
  const action = element.dataset.action;

  if (action === "create-host-offer") {
    void runAsyncAction(async () => {
      resetPeerSession();
      ui.multiplayer.role = "host";
      const peer = createPeerSession();
      ui.multiplayer.localSignal = await peer.createHostOffer();
    });
    return;
  }

  if (action === "create-guest-answer") {
    void runAsyncAction(async () => {
      const hostOffer = ui.multiplayer.remoteSignalInput;
      resetPeerSession();
      ui.multiplayer.role = "guest";
      ui.multiplayer.remoteSignalInput = hostOffer;
      const peer = createPeerSession();
      ui.multiplayer.localSignal = await peer.createGuestAnswer(hostOffer);
    });
    return;
  }

  if (action === "accept-guest-answer") {
    void runAsyncAction(async () => {
      if (!ui.multiplayer.session) {
        throw new Error("Create a host offer before accepting an answer.");
      }

      await ui.multiplayer.session.acceptGuestAnswer(ui.multiplayer.remoteSignalInput);
    });
    return;
  }

  if (action === "copy-local-signal") {
    void runAsyncAction(async () => {
      if (!ui.multiplayer.localSignal) {
        return;
      }

      await navigator.clipboard.writeText(ui.multiplayer.localSignal);
      ui.multiplayer.log = ["Signal copied", ...ui.multiplayer.log].slice(0, 20);
    });
    return;
  }

  runAction(() => {
    if (action === "toggle-multiplayer") {
      ui.multiplayer.open = !ui.multiplayer.open;
    }

    if (action === "set-multiplayer-role") {
      const role = element.dataset.role;
      if (role === "host" || role === "guest") {
        resetPeerSession();
        ui.multiplayer.role = role;
      }
    }

    if (action === "close-peer") {
      resetPeerSession();
    }

    if (action === "broadcast-game") {
      if (!ui.game) {
        throw new Error("Start a game before broadcasting state.");
      }

      sendPeerMessage(createGameStateMessage(ui.game));
      ui.multiplayer.log = ["Game state sent", ...ui.multiplayer.log].slice(0, 20);
    }

    if (action === "add-player") {
      const nextNumber = ui.setupPlayers.length + 1;
      ui.setupPlayers.push({ id: `draft-${Date.now()}`, name: `Player ${nextNumber}` });
    }

    if (action === "remove-player") {
      const playerId = element.dataset.playerId;
      if (playerId && ui.setupPlayers.length > 3) {
        ui.setupPlayers = ui.setupPlayers.filter((player) => player.id !== playerId);
      }
    }

    if (action === "open-hand") {
      ui.visiblePlayerId = element.dataset.playerId ?? null;
      ui.privacyGateOpen = true;
      ui.selectedCardIds = [];
    }

    if (action === "hide-hand") {
      ui.privacyGateOpen = false;
      ui.selectedCardIds = [];
    }

    if (action === "pick-winner") {
      const submissionIndex = Number(element.dataset.submissionIndex);
      if (ui.game) {
        ui.game = pickWinner(ui.game, submissionIndex);
        saveGame();
      }
    }

    if (action === "next-round") {
      if (ui.game) {
        ui.game = nextRound(ui.game);
        syncUiToGame();
        saveGame();
      }
    }

    if (action === "show-setup") {
      ui.game = null;
      ui.visiblePlayerId = null;
      ui.privacyGateOpen = false;
      ui.selectedCardIds = [];
      localStorage.removeItem(STORAGE_KEY);
    }
  });
}

function runAction(action: () => void): void {
  try {
    ui.error = null;
    action();
  } catch (error) {
    ui.error = error instanceof Error ? error.message : "Something went wrong.";
  }

  render();
}

async function runAsyncAction(action: () => Promise<void>): Promise<void> {
  try {
    ui.error = null;
    await action();
  } catch (error) {
    ui.error = error instanceof Error ? error.message : "Something went wrong.";
  }

  render();
}

function selectedDecks(): DeckDefinition[] {
  return decksForGame(decks, ui.selectedDeckIds);
}

function syncUiToGame(): void {
  if (!ui.game?.round) {
    return;
  }

  ui.visiblePlayerId = ui.game.round.activePlayerId;
  ui.privacyGateOpen = false;
  ui.selectedCardIds = [];
}

function restoreGame(): GameState | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as GameState;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function saveGame(): void {
  if (ui.game) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ui.game));
  }
}

function createPeerSession(): WebRtcPeer {
  const peer = new WebRtcPeer({
    onStatusChange: (status) => {
      ui.multiplayer.status = status;
      render();
    },
    onMessage: (message) => {
      handlePeerMessage(message);
      render();
    }
  });

  ui.multiplayer.session = peer;
  ui.multiplayer.status = peer.status;
  ui.multiplayer.localSignal = "";
  ui.multiplayer.log = [];
  return peer;
}

function resetPeerSession(): void {
  ui.multiplayer.session?.close();
  ui.multiplayer.session = null;
  ui.multiplayer.status = "idle";
  ui.multiplayer.localSignal = "";
  ui.multiplayer.remoteSignalInput = "";
  ui.multiplayer.outboundText = "";
  ui.multiplayer.log = [];
  ui.multiplayer.remoteGame = null;
}

function sendPeerMessage(message: PeerMessage): void {
  if (!ui.multiplayer.session) {
    throw new Error("Peer connection is not open.");
  }

  ui.multiplayer.session.send(message);
}

function formatPeerMessage(message: PeerMessage): string {
  if (isGameStateMessage(message)) {
    const round = message.payload.game.round?.number ?? 0;
    return `Game state received: round ${round}`;
  }

  if (message.type === "chat" && typeof message.payload === "string") {
    return `Peer: ${message.payload}`;
  }

  return `Peer: ${JSON.stringify(message.payload)}`;
}

function handlePeerMessage(message: PeerMessage): void {
  if (isGameStateMessage(message)) {
    ui.multiplayer.remoteGame = message.payload.game;
  }

  ui.multiplayer.log = [formatPeerMessage(message), ...ui.multiplayer.log].slice(0, 20);
}

function playerById(game: GameState, playerId: string): Player {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player not found.");
  }
  return player;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
