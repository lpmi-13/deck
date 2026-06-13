import "./style.css";
import { loadDecks } from "./data/deckLoader";
import { createGame, decksForGame, nextRound, pickWinner, submitCards } from "./game/reducer";
import type { AnswerCard, DeckDefinition, GameState, Player, PlayMode, Submission } from "./game/types";
import {
  createGameSummaryMessage,
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

interface HostPeerUi {
  id: string;
  label: string;
  status: ConnectionStatus;
  session: WebRtcPeer;
  localSignal: string;
  remoteSignalInput: string;
  peerPlayerId: string | null;
  log: string[];
}

interface MultiplayerUiState {
  open: boolean;
  role: "host" | "guest";
  hostPeers: HostPeerUi[];
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
    hostPeers: [],
    status: "idle",
    session: null,
    localSignal: "",
    remoteSignalInput: "",
    outboundText: "",
    log: [],
    remoteGame: null,
    remoteSummary: null,
    remotePlayerView: null,
    remotePlayerId: ""
  }
};

syncUiToGame();
render();

function render(): void {
  const focusSnapshot = captureFocus();

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <img class="brand-logo" src="${logoUrl}" alt="" />
          <div>
            <h1>Cards Against Containers</h1>
            <p>Static pass-and-play prototype</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button
            class="secondary"
            data-action="toggle-multiplayer"
            type="button"
            aria-expanded="${ui.multiplayer.open ? "true" : "false"}"
            aria-controls="multiplayer-panel"
          >
            ${ui.multiplayer.open ? "Hide P2P" : "P2P"}
          </button>
          ${ui.game ? '<button class="secondary" data-action="show-setup" type="button">New Game</button>' : ""}
        </div>
      </header>
      <main>
        ${ui.error ? `<div class="notice error" role="alert">${escapeHtml(ui.error)}</div>` : ""}
        ${ui.game ? renderGame(ui.game) : renderSetup()}
        ${ui.multiplayer.open ? renderMultiplayerPanel() : ""}
      </main>
    </div>
  `;

  bindEvents();
  restoreFocus(focusSnapshot);
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
        aria-label="Remove player ${index + 1}"
        ${canRemove ? "" : "disabled"}
      >
        <span aria-hidden="true">&times;</span>
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

  if (game.playMode === "multi-device" && isPlayerClaimedByHostPeer(activePlayer.id)) {
    const peer = hostPeerForPlayer(activePlayer.id);
    return `
      <div class="phase-panel">
        <div class="section-heading">
          <h2>Waiting for ${escapeHtml(activePlayer.name)}</h2>
          <p>${submittedCount} of ${neededCount} players have submitted. The connected guest can submit from their device.</p>
        </div>
        <button class="secondary" data-action="send-player-view" data-peer-id="${peer?.id ?? ""}" type="button" ${peer?.status === "connected" ? "" : "disabled"}>Resend Player View</button>
      </div>
    `;
  }

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
  if (game.playMode === "multi-device" && isPlayerClaimedByHostPeer(judge.id)) {
    const peer = hostPeerForPlayer(judge.id);
    return `
      <div class="phase-panel">
        <div class="section-heading">
          <h2>Waiting for ${escapeHtml(judge.name)}</h2>
          <p>The connected guest is judging this round from their device.</p>
        </div>
        <button class="secondary" data-action="send-player-view" data-peer-id="${peer?.id ?? ""}" type="button" ${peer?.status === "connected" ? "" : "disabled"}>Resend Player View</button>
      </div>
    `;
  }
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
      <button class="primary" data-action="pick-winner" data-submission-index="${originalIndex}" type="button" aria-label="Pick winner: submission ${displayIndex + 1}">Pick Winner</button>
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
    <section class="multiplayer-panel" id="multiplayer-panel" aria-labelledby="multiplayer-heading">
      <div class="section-heading">
        <h2 id="multiplayer-heading">Peer Connection</h2>
        <p>${renderMultiplayerStatus()}</p>
      </div>

      <div class="role-tabs" role="group" aria-label="Connection role">
        <button
          class="secondary ${ui.multiplayer.role === "host" ? "is-active" : ""}"
          data-action="set-multiplayer-role"
          data-role="host"
          type="button"
          aria-pressed="${ui.multiplayer.role === "host" ? "true" : "false"}"
        >
          Host
        </button>
        <button
          class="secondary ${ui.multiplayer.role === "guest" ? "is-active" : ""}"
          data-action="set-multiplayer-role"
          data-role="guest"
          type="button"
          aria-pressed="${ui.multiplayer.role === "guest" ? "true" : "false"}"
        >
          Guest
        </button>
      </div>

      ${ui.multiplayer.role === "host" ? renderHostSignaling() : renderGuestSignaling()}
      ${renderPeerMessenger()}
      ${ui.multiplayer.role === "guest" ? renderGuestGameView() : ""}
      ${ui.multiplayer.remoteGame ? renderRemoteGameSnapshot(ui.multiplayer.remoteGame) : ""}
    </section>
  `;
}

function renderMultiplayerStatus(): string {
  if (ui.multiplayer.role === "host") {
    const connectedCount = connectedHostPeers().length;
    const totalCount = ui.multiplayer.hostPeers.length;
    return `Host: <strong class="status-pill status-${connectedCount > 0 ? "connected" : "idle"}">${connectedCount}/${totalCount} guests connected</strong>`;
  }

  return `Status: <strong class="status-pill status-${ui.multiplayer.status}">${ui.multiplayer.status}</strong>`;
}

function renderHostSignaling(): string {
  return `
    <div class="host-peers">
      <div class="button-row">
        <button class="primary" data-action="create-host-offer" type="button">Add Guest Connection</button>
        <button class="secondary" data-action="broadcast-game" type="button" ${connectedHostPeers().length > 0 && ui.game ? "" : "disabled"}>Broadcast All</button>
      </div>
      ${
        ui.multiplayer.hostPeers.length > 0
          ? ui.multiplayer.hostPeers.map(renderHostPeerCard).join("")
          : '<p class="muted-copy">Create one guest connection for each remote player.</p>'
      }
    </div>
  `;
}

function renderHostPeerCard(peer: HostPeerUi): string {
  const peerPlayer = ui.game?.players.find((player) => player.id === peer.peerPlayerId);
  return `
    <article class="host-peer-card">
      <div class="section-heading">
        <h3>${escapeHtml(peer.label)}</h3>
        <p>Status: <strong class="status-pill status-${peer.status}">${peer.status}</strong></p>
      </div>
      <div class="signal-grid">
        <div class="signal-field">
          <div class="field-label" id="host-offer-label-${peer.id}">Host offer</div>
          <textarea readonly name="hostLocalSignal" aria-labelledby="host-offer-label-${peer.id}">${escapeHtml(peer.localSignal)}</textarea>
          <button class="secondary" data-action="copy-local-signal" data-peer-id="${peer.id}" type="button" ${peer.localSignal ? "" : "disabled"}>Copy Offer</button>
        </div>
        <div class="signal-field">
          <div class="field-label" id="guest-answer-label-${peer.id}">Guest answer</div>
          <textarea name="hostRemoteSignal" data-peer-id="${peer.id}" aria-labelledby="guest-answer-label-${peer.id}">${escapeHtml(peer.remoteSignalInput)}</textarea>
          <button class="primary" data-action="accept-guest-answer" data-peer-id="${peer.id}" type="button">Accept Answer</button>
        </div>
      </div>
      <div class="remote-game-grid">
        <span>Player</span>
        <strong>${escapeHtml(peerPlayer?.name ?? "Not selected")}</strong>
      </div>
      <div class="button-row">
        <button class="secondary" data-action="send-player-view" data-peer-id="${peer.id}" type="button" ${peer.status === "connected" && ui.game && peer.peerPlayerId ? "" : "disabled"}>Send Player View</button>
        <button class="secondary" data-action="close-peer" data-peer-id="${peer.id}" type="button">Close</button>
      </div>
      <div class="message-log" aria-live="polite">
        ${peer.log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")}
      </div>
    </article>
  `;
}

function renderGuestSignaling(): string {
  return `
    <div class="signal-grid">
      <div class="signal-field">
        <div class="field-label" id="guest-host-offer-label">Host offer</div>
        <textarea name="remoteSignal" aria-labelledby="guest-host-offer-label">${escapeHtml(ui.multiplayer.remoteSignalInput)}</textarea>
        <button class="primary" data-action="create-guest-answer" type="button">Create Answer</button>
      </div>
      <div class="signal-field">
        <div class="field-label" id="guest-local-answer-label">Guest answer</div>
        <textarea readonly name="localSignal" aria-labelledby="guest-local-answer-label">${escapeHtml(ui.multiplayer.localSignal)}</textarea>
        <button class="secondary" data-action="copy-local-signal" type="button" ${ui.multiplayer.localSignal ? "" : "disabled"}>Copy</button>
      </div>
    </div>
  `;
}

function renderPeerMessenger(): string {
  if (ui.multiplayer.role === "host") {
    return "";
  }

  return `
    <form class="peer-messenger" data-form="peer-send">
      <label class="field">
        <span>Message</span>
        <input name="peerMessage" value="${escapeAttribute(ui.multiplayer.outboundText)}" />
      </label>
      <div class="button-row">
        <button class="primary" type="submit" ${ui.multiplayer.status === "connected" ? "" : "disabled"}>Send</button>
        <button class="secondary" data-action="close-peer" type="button" ${ui.multiplayer.session ? "" : "disabled"}>Close</button>
      </div>
      <div class="message-log" aria-live="polite">
        ${ui.multiplayer.log.map((entry) => `<div>${escapeHtml(entry)}</div>`).join("")}
      </div>
    </form>
  `;
}

function renderGuestGameView(): string {
  if (!ui.multiplayer.remoteSummary && !ui.multiplayer.remotePlayerView) {
    return `
      <div class="remote-game">
        <div class="field-label">Guest game</div>
        <p class="muted-copy">Connect to a host and wait for a game summary.</p>
      </div>
    `;
  }

  const summary = ui.multiplayer.remotePlayerView ?? ui.multiplayer.remoteSummary;
  if (!summary) {
    return "";
  }

  return `
    <div class="remote-game guest-game">
      <div class="field-label">Guest game</div>
      ${renderGuestPlayerSelector(summary)}
      ${ui.multiplayer.remotePlayerView ? renderRemotePlayerView(ui.multiplayer.remotePlayerView) : renderGuestSummary(summary)}
    </div>
  `;
}

function renderGuestPlayerSelector(summary: GameSummaryPayload): string {
  return `
    <div class="guest-selector">
      <label class="field">
        <span>Your player</span>
        <select name="remotePlayerId">
          <option value="">Choose player</option>
          ${summary.players
            .map(
              (player) =>
                `<option value="${player.id}" ${ui.multiplayer.remotePlayerId === player.id ? "selected" : ""}>${escapeHtml(player.name)}</option>`
            )
            .join("")}
        </select>
      </label>
      <button class="primary" data-action="request-player-view" type="button" ${ui.multiplayer.status === "connected" && ui.multiplayer.remotePlayerId ? "" : "disabled"}>Request View</button>
    </div>
  `;
}

function renderGuestSummary(summary: GameSummaryPayload): string {
  const judge = summary.players.find((player) => player.id === summary.round?.judgeId);
  const activePlayer = summary.players.find((player) => player.id === summary.round?.activePlayerId);
  return `
    <div class="remote-game-grid">
      <span>Phase</span>
      <strong>${escapeHtml(summary.phase)}</strong>
      <span>Round</span>
      <strong>${summary.round?.number ?? 0}</strong>
      <span>Judge</span>
      <strong>${escapeHtml(judge?.name ?? "None")}</strong>
      <span>Turn</span>
      <strong>${escapeHtml(activePlayer?.name ?? "Waiting")}</strong>
    </div>
  `;
}

function renderRemotePlayerView(view: PlayerViewPayload): string {
  const viewer = view.players.find((player) => player.id === view.viewerPlayerId);
  const judge = view.players.find((player) => player.id === view.round?.judgeId);
  const activePlayer = view.players.find((player) => player.id === view.round?.activePlayerId);
  return `
    <div class="remote-view">
      <div class="remote-game-grid">
        <span>You</span>
        <strong>${escapeHtml(viewer?.name ?? "Unknown")}</strong>
        <span>Phase</span>
        <strong>${escapeHtml(view.phase)}</strong>
        <span>Judge</span>
        <strong>${escapeHtml(judge?.name ?? "None")}</strong>
        <span>Turn</span>
        <strong>${escapeHtml(activePlayer?.name ?? "Waiting")}</strong>
      </div>
      ${view.round ? renderRemoteQuestion(view) : ""}
      ${renderRemotePlayerAction(view)}
    </div>
  `;
}

function renderRemoteQuestion(view: PlayerViewPayload): string {
  if (!view.round) {
    return "";
  }

  return `
    <article class="remote-question">
      <div class="card-label">Question</div>
      <p>${escapeHtml(view.round.question.text)}</p>
      <span class="pick-count">Pick ${view.round.question.pick}</span>
    </article>
  `;
}

function renderRemotePlayerAction(view: PlayerViewPayload): string {
  if (!view.round) {
    return "";
  }

  if (view.phase === "submitting" && view.round.activePlayerId === view.viewerPlayerId) {
    return `
      <form class="remote-action" data-form="remote-submit-cards">
        <div class="hand-grid">
          ${view.hand.map((card) => renderRemoteHandCard(card, view.round?.question.pick ?? 1)).join("")}
        </div>
        <button class="primary" type="submit">Submit Selected</button>
      </form>
    `;
  }

  if (view.phase === "revealing" && view.round.judgeId === view.viewerPlayerId) {
    return `
      <div class="submission-grid">
        ${view.judgeSubmissions
          .map(
            (submission) => `
              <article class="submission-card">
                <div class="card-label">Submission ${submission.displayIndex + 1}</div>
                <div class="submission-answers">
                  ${submission.cards.map((card) => `<p>${escapeHtml(card.text)}</p>`).join("")}
                </div>
                <button class="primary" data-action="remote-pick-winner" data-submission-index="${submission.originalIndex}" type="button" aria-label="Pick winner: submission ${submission.displayIndex + 1}">Pick Winner</button>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  if (view.phase === "roundEnd" && view.round.winnerId) {
    const winner = view.players.find((player) => player.id === view.round?.winnerId);
    return `<p class="muted-copy">${escapeHtml(winner?.name ?? "A player")} won the round. The host can start the next round.</p>`;
  }

  if (view.phase === "gameOver") {
    const winner = [...view.players].sort((left, right) => right.score - left.score)[0];
    return `<p class="muted-copy">${escapeHtml(winner.name)} won the game.</p>`;
  }

  return `<p class="muted-copy">Waiting for the host or another player.</p>`;
}

function renderRemoteHandCard(card: AnswerCard, pick: number): string {
  const selected = ui.remoteSelectedCardIds.includes(card.id);
  const inputType = pick === 1 ? "radio" : "checkbox";
  return `
    <label class="answer-card ${selected ? "is-selected" : ""}">
      <input
        type="${inputType}"
        name="remoteSelectedCard"
        value="${card.id}"
        ${selected ? "checked" : ""}
      />
      <span>${escapeHtml(card.text)}</span>
    </label>
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
      syncConnectedPeerViews();
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

  app.querySelector<HTMLFormElement>('[data-form="remote-submit-cards"]')?.addEventListener("submit", (event) => {
    event.preventDefault();
    runAction(() => {
      const view = ui.multiplayer.remotePlayerView;
      if (!view) {
        throw new Error("No remote player view is available.");
      }

      const requiredCards = view.round?.question.pick ?? 1;
      if (ui.remoteSelectedCardIds.length !== requiredCards) {
        throw new Error(`Select ${requiredCards} card${requiredCards === 1 ? "" : "s"}.`);
      }

      sendPeerMessage(createSubmitCardsMessage(view.viewerPlayerId, ui.remoteSelectedCardIds));
      ui.remoteSelectedCardIds = [];
      ui.multiplayer.log = ["Cards submitted to host", ...ui.multiplayer.log].slice(0, 20);
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

  app.querySelectorAll<HTMLInputElement>('input[name="remoteSelectedCard"]').forEach((input) => {
    input.addEventListener("change", () => {
      ui.remoteSelectedCardIds = Array.from(
        app.querySelectorAll<HTMLInputElement>('input[name="remoteSelectedCard"]:checked')
      ).map((element) => element.value);
      render();
    });
  });

  app.querySelector<HTMLSelectElement>('select[name="remotePlayerId"]')?.addEventListener("change", (event) => {
    ui.multiplayer.remotePlayerId = (event.currentTarget as HTMLSelectElement).value;
    render();
  });

  app.querySelector<HTMLTextAreaElement>('textarea[name="remoteSignal"]')?.addEventListener("input", (event) => {
    ui.multiplayer.remoteSignalInput = (event.currentTarget as HTMLTextAreaElement).value;
  });

  app.querySelectorAll<HTMLTextAreaElement>('textarea[name="hostRemoteSignal"]').forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const peer = hostPeerById(textarea.dataset.peerId);
      if (peer) {
        peer.remoteSignalInput = textarea.value;
      }
    });
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
      ui.multiplayer.role = "host";
      const peer = createHostPeerSession();
      ui.multiplayer.hostPeers.push(peer);
      peer.localSignal = await peer.session.createHostOffer();
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
      const peerId = element.dataset.peerId;
      if (peerId) {
        const peer = requireHostPeer(peerId);
        await peer.session.acceptGuestAnswer(peer.remoteSignalInput);
        return;
      }

      if (!ui.multiplayer.session) {
        throw new Error("Create a host offer before accepting an answer.");
      }
      await ui.multiplayer.session.acceptGuestAnswer(ui.multiplayer.remoteSignalInput);
    });
    return;
  }

  if (action === "copy-local-signal") {
    void runAsyncAction(async () => {
      const peerId = element.dataset.peerId;
      const signal = peerId ? requireHostPeer(peerId).localSignal : ui.multiplayer.localSignal;
      if (!signal) {
        return;
      }

      await navigator.clipboard.writeText(signal);
      if (peerId) {
        appendHostPeerLog(peerId, "Signal copied");
      } else {
        ui.multiplayer.log = ["Signal copied", ...ui.multiplayer.log].slice(0, 20);
      }
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
      const peerId = element.dataset.peerId;
      if (peerId) {
        closeHostPeer(peerId);
      } else {
        resetPeerSession();
      }
    }

    if (action === "broadcast-game") {
      if (!ui.game) {
        throw new Error("Start a game before broadcasting state.");
      }

      broadcastGameSummary();
      syncConnectedPeerViews();
      ui.multiplayer.log = ["Game summary sent", ...ui.multiplayer.log].slice(0, 20);
    }

    if (action === "send-player-view") {
      const peerId = element.dataset.peerId;
      if (peerId) {
        syncHostPeerView(peerId);
      } else {
        syncConnectedPeerViews();
      }
    }

    if (action === "request-player-view") {
      if (!ui.multiplayer.remotePlayerId) {
        throw new Error("Choose your player first.");
      }

      sendPeerMessage(createPlayerViewRequestMessage(ui.multiplayer.remotePlayerId));
      ui.multiplayer.log = ["Player view requested", ...ui.multiplayer.log].slice(0, 20);
    }

    if (action === "remote-pick-winner") {
      const submissionIndex = Number(element.dataset.submissionIndex);
      sendPeerMessage(createPickWinnerMessage(submissionIndex));
      ui.multiplayer.log = ["Winner pick sent to host", ...ui.multiplayer.log].slice(0, 20);
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
        syncConnectedPeerViews();
      }
    }

    if (action === "next-round") {
      if (ui.game) {
        ui.game = nextRound(ui.game);
        syncUiToGame();
        saveGame();
        syncConnectedPeerViews();
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
    return normalizeRestoredGame(JSON.parse(stored) as GameState);
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

function createHostPeerSession(): HostPeerUi {
  const id = `host-peer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const label = `Guest ${ui.multiplayer.hostPeers.length + 1}`;
  const peerState = {} as HostPeerUi;
  const peer = new WebRtcPeer({
    onStatusChange: (status) => {
      peerState.status = status;
      if (status === "connected" && ui.game) {
        sendMessageToHostPeer(peerState.id, createGameSummaryMessage(ui.game));
        syncHostPeerView(peerState.id);
      }
      render();
    },
    onMessage: (message) => {
      try {
        handlePeerMessage(message, peerState.id);
        ui.error = null;
      } catch (error) {
        ui.error = error instanceof Error ? error.message : "Something went wrong.";
      }
      render();
    }
  });

  Object.assign(peerState, {
    id,
    label,
    status: peer.status,
    session: peer,
    localSignal: "",
    remoteSignalInput: "",
    peerPlayerId: null,
    log: []
  } satisfies HostPeerUi);

  return peerState;
}

function createPeerSession(): WebRtcPeer {
  const peer = new WebRtcPeer({
    onStatusChange: (status) => {
      ui.multiplayer.status = status;
      render();
    },
    onMessage: (message) => {
      try {
        handlePeerMessage(message);
        ui.error = null;
      } catch (error) {
        ui.error = error instanceof Error ? error.message : "Something went wrong.";
      }
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
  ui.multiplayer.hostPeers.forEach((peer) => peer.session.close());
  ui.multiplayer.hostPeers = [];
  ui.multiplayer.session = null;
  ui.multiplayer.status = "idle";
  ui.multiplayer.localSignal = "";
  ui.multiplayer.remoteSignalInput = "";
  ui.multiplayer.outboundText = "";
  ui.multiplayer.log = [];
  ui.multiplayer.remoteGame = null;
  ui.multiplayer.remoteSummary = null;
  ui.multiplayer.remotePlayerView = null;
  ui.multiplayer.remotePlayerId = "";
}

function sendPeerMessage(message: PeerMessage): void {
  if (!ui.multiplayer.session) {
    throw new Error("Peer connection is not open.");
  }

  ui.multiplayer.session.send(message);
}

function sendMessageToHostPeer(peerId: string, message: PeerMessage): void {
  const peer = requireHostPeer(peerId);
  if (peer.status !== "connected") {
    throw new Error(`${peer.label} is not connected.`);
  }

  peer.session.send(message);
}

function broadcastGameSummary(): void {
  if (!ui.game) {
    return;
  }

  connectedHostPeers().forEach((peer) => {
    sendMessageToHostPeer(peer.id, createGameSummaryMessage(ui.game as GameState));
  });
}

function syncConnectedPeerViews(): void {
  if (!ui.game) {
    return;
  }

  broadcastGameSummary();
  connectedHostPeers().forEach((peer) => {
    if (peer.peerPlayerId) {
      sendMessageToHostPeer(peer.id, createPlayerViewMessage(ui.game as GameState, peer.peerPlayerId));
    }
  });
}

function syncHostPeerView(peerId: string): void {
  if (!ui.game) {
    return;
  }

  const peer = requireHostPeer(peerId);
  if (peer.status !== "connected") {
    return;
  }

  sendMessageToHostPeer(peer.id, createGameSummaryMessage(ui.game));

  if (peer.peerPlayerId) {
    sendMessageToHostPeer(peer.id, createPlayerViewMessage(ui.game, peer.peerPlayerId));
  }
}

function closeHostPeer(peerId: string): void {
  const peer = hostPeerById(peerId);
  peer?.session.close();
  ui.multiplayer.hostPeers = ui.multiplayer.hostPeers.filter((candidate) => candidate.id !== peerId);
}

function connectedHostPeers(): HostPeerUi[] {
  return ui.multiplayer.hostPeers.filter((peer) => peer.status === "connected");
}

function hostPeerById(peerId: string | undefined): HostPeerUi | undefined {
  return ui.multiplayer.hostPeers.find((peer) => peer.id === peerId);
}

function requireHostPeer(peerId: string): HostPeerUi {
  const peer = hostPeerById(peerId);
  if (!peer) {
    throw new Error("Guest connection was not found.");
  }
  return peer;
}

function hostPeerForPlayer(playerId: string): HostPeerUi | undefined {
  return ui.multiplayer.hostPeers.find((peer) => peer.peerPlayerId === playerId);
}

function isPlayerClaimedByHostPeer(playerId: string): boolean {
  return Boolean(hostPeerForPlayer(playerId));
}

function appendHostPeerLog(peerId: string, entry: string): void {
  const peer = hostPeerById(peerId);
  if (peer) {
    peer.log = [entry, ...peer.log].slice(0, 20);
  }
}

function claimHostPeerPlayer(peerId: string, playerId: string): void {
  ui.multiplayer.hostPeers.forEach((peer) => {
    if (peer.id !== peerId && peer.peerPlayerId === playerId) {
      peer.peerPlayerId = null;
      appendHostPeerLog(peer.id, "Player claim moved to another guest");
    }
  });

  requireHostPeer(peerId).peerPlayerId = playerId;
}

function formatPeerMessage(message: PeerMessage): string {
  if (isGameSummaryMessage(message)) {
    const round = message.payload.round?.number ?? 0;
    return `Game summary received: round ${round}`;
  }

  if (isPlayerViewMessage(message)) {
    const round = message.payload.round?.number ?? 0;
    return `Player view received: round ${round}`;
  }

  if (isPlayerViewRequestMessage(message)) {
    return `Player view requested for ${message.payload.playerId}`;
  }

  if (isSubmitCardsMessage(message)) {
    return `Cards submitted by ${message.payload.playerId}`;
  }

  if (isPickWinnerMessage(message)) {
    return `Winner pick received for submission ${message.payload.submissionIndex + 1}`;
  }

  if (isGameStateMessage(message)) {
    const round = message.payload.game.round?.number ?? 0;
    return `Game state received: round ${round}`;
  }

  if (message.type === "chat" && typeof message.payload === "string") {
    return `Peer: ${message.payload}`;
  }

  return `Peer: ${JSON.stringify(message.payload)}`;
}

function handlePeerMessage(message: PeerMessage, hostPeerId?: string): void {
  if (hostPeerId) {
    handleHostPeerMessage(hostPeerId, message);
    appendHostPeerLog(hostPeerId, formatPeerMessage(message));
    return;
  }

  handleGuestPeerMessage(message);
  ui.multiplayer.log = [formatPeerMessage(message), ...ui.multiplayer.log].slice(0, 20);
}

function handleGuestPeerMessage(message: PeerMessage): void {
  if (isGameSummaryMessage(message)) {
    ui.multiplayer.remoteSummary = message.payload;
  }

  if (isPlayerViewMessage(message)) {
    ui.multiplayer.remotePlayerView = message.payload;
    ui.multiplayer.remoteSummary = message.payload;
    ui.multiplayer.remotePlayerId = message.payload.viewerPlayerId;
    ui.remoteSelectedCardIds = [];
  }

  if (isGameStateMessage(message)) {
    ui.multiplayer.remoteGame = message.payload.game;
  }
}

function handleHostPeerMessage(peerId: string, message: PeerMessage): void {
  if (isPlayerViewRequestMessage(message)) {
    if (ui.game && !ui.game.players.some((player) => player.id === message.payload.playerId)) {
      throw new Error("Requested player does not exist in this game.");
    }

    claimHostPeerPlayer(peerId, message.payload.playerId);
    syncHostPeerView(peerId);
  }

  if (isSubmitCardsMessage(message)) {
    if (!ui.game) {
      throw new Error("No host game is available for remote submission.");
    }
    requireHostPeerPlayer(peerId, message.payload.playerId);

    ui.game = submitCards(ui.game, message.payload.playerId, message.payload.cardIds);
    syncUiToGame();
    saveGame();
    syncConnectedPeerViews();
  }

  if (isPickWinnerMessage(message)) {
    if (!ui.game) {
      throw new Error("No host game is available for remote judging.");
    }
    const peer = requireHostPeer(peerId);
    if (!peer.peerPlayerId || ui.game.round?.judgeId !== peer.peerPlayerId) {
      throw new Error("Only the remote judge can pick a winner.");
    }

    ui.game = pickWinner(ui.game, message.payload.submissionIndex);
    saveGame();
    syncConnectedPeerViews();
  }
}

function requireHostPeerPlayer(peerId: string, playerId: string): void {
  const peer = requireHostPeer(peerId);
  if (peer.peerPlayerId !== playerId) {
    throw new Error(`${peer.label} has not claimed that player.`);
  }
}

function normalizeRestoredGame(game: GameState): GameState {
  return {
    ...game,
    playMode: game.playMode ?? "single-device"
  };
}

function playerById(game: GameState, playerId: string): Player {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player not found.");
  }
  return player;
}

const FOCUS_MATCH_ATTRIBUTES = [
  "name",
  "type",
  "value",
  "data-action",
  "data-role",
  "data-peer-id",
  "data-player-id",
  "data-submission-index"
] as const;

interface FocusSnapshot {
  tag: string;
  attributes: Record<string, string | null>;
  selectionStart: number | null;
  selectionEnd: number | null;
}

// The whole app re-renders by replacing innerHTML, which drops keyboard focus to
// the document body. Capture enough of the focused control to find its equivalent
// after the re-render so keyboard and screen-reader users keep their place.
function captureFocus(): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !app.contains(active)) {
    return null;
  }

  const attributes: Record<string, string | null> = {};
  for (const attribute of FOCUS_MATCH_ATTRIBUTES) {
    attributes[attribute] = active.getAttribute(attribute);
  }

  let selectionStart: number | null = null;
  let selectionEnd: number | null = null;
  if (active instanceof HTMLTextAreaElement) {
    selectionStart = active.selectionStart;
    selectionEnd = active.selectionEnd;
  } else if (active instanceof HTMLInputElement) {
    try {
      selectionStart = active.selectionStart;
      selectionEnd = active.selectionEnd;
    } catch {
      // Inputs such as type="number" do not expose a text selection range.
    }
  }

  return { tag: active.tagName, attributes, selectionStart, selectionEnd };
}

function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (!snapshot) {
    return;
  }

  const candidates = app.querySelectorAll<HTMLElement>("button, input, select, textarea");
  for (const candidate of candidates) {
    if (candidate.tagName !== snapshot.tag) {
      continue;
    }

    const matches = FOCUS_MATCH_ATTRIBUTES.every(
      (attribute) => candidate.getAttribute(attribute) === snapshot.attributes[attribute]
    );
    if (!matches) {
      continue;
    }

    candidate.focus({ preventScroll: true });
    if (
      snapshot.selectionStart !== null &&
      (candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement)
    ) {
      try {
        candidate.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd ?? snapshot.selectionStart);
      } catch {
        // Some input types do not support setSelectionRange; focus alone is enough.
      }
    }
    return;
  }
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
