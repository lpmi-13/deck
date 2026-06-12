# Static Multiplayer Web App Plan

The goal is to turn this deck repository into a static web app that can be played with other people, with no server-side component. The implementation should start with a local pass-and-play game, then add peer-to-peer multiplayer once the game state and UI are stable.

## 1. Convert Deck Data

Keep the existing text files as source data:

- `questions.txt` / `answers.txt`: Cards Against Containers deck
- `cas_questions.txt` / `cas_answers.txt`: second deck variant

Parsing rules:

- Parse one quoted line as one card.
- Decode HTML entities in the `cas_*` files.
- Generate stable card IDs from deck name, card type, and line number.
- Detect prompt requirements from blank counts.
- Support prompts with no blanks by requiring one answer.
- Support prompts with multiple blanks, including the existing two-answer prompt: `I'm sure ________ will reimplement ________ soon.`

## 2. Static TypeScript App Skeleton

Build a static frontend only:

- TypeScript source.
- Static build output suitable for GitHub Pages, Netlify, Cloudflare Pages, or any file host.
- No backend, database, or server API.
- Keep the first version dependency-light so the app can be hosted and maintained easily.

Suggested structure:

```text
src/
  main.ts
  style.css
  data/
    deckLoader.ts
  game/
    reducer.ts
    rules.ts
    shuffle.ts
    types.ts
  multiplayer/
    transport.ts
    webrtc.ts
    qrSignal.ts
```

## 3. Core Game Engine

Make the game logic framework-independent and serializable.

Core state:

- players
- current judge/czar
- question deck
- answer deck
- discard piles
- player hands
- submissions
- score
- round phase

Core actions:

- create game
- add/remove player
- start round
- submit answer card or cards
- reveal submissions
- pick winner
- next round
- reshuffle
- restart game

Use an event/reducer style so local play and WebRTC multiplayer can share the same rules.

## 4. First Playable Version

Start with one-device play:

- App opens directly to game setup, not a marketing page.
- Select deck or decks.
- Add players.
- Deal 10 answer cards per player.
- Pass-and-play mode:
  - active player sees their hand
  - active player submits card(s)
  - screen hides before the next player
  - judge sees anonymized submissions
  - judge picks winner
- Persist active game to `localStorage` so refresh does not destroy it.

## 5. Static Multiplayer Option

WebRTC is possible without a server, but the main limitation is signaling. WebRTC peers must exchange offer and answer data somehow. A QR flow can do this manually.

Best static-only design:

- One browser is the host and authoritative game state owner.
- Each player connects to the host through one WebRTC data channel.
- Avoid full mesh networking.
- Clients send player actions.
- Host broadcasts state updates.

QR join flow:

1. Host creates a room and displays a QR code containing a compressed WebRTC offer in the URL hash.
2. Player scans it and opens the static app.
3. Player browser creates a WebRTC answer.
4. Player shows an answer QR code.
5. Host scans or pastes that answer.
6. Data channel opens.

This can work with a static app, but it will not be as smooth as "scan one QR and join" unless there is a server or third-party signaling service. Without TURN, some restrictive networks will fail. Public STUN can help, but that still relies on external infrastructure, just not a project-owned backend.

## 6. Multiplayer Milestone

Add after the local game is solid:

- WebRTC transport abstraction.
- Copy/paste signaling prototype.
- QR encode/decode.
- Host room screen.
- Join screen.
- Reconnect or rejoin behavior where practical.
- Connection status per player.
- Keep host migration out of scope for the first multiplayer version.

Local mode should keep working even if peer-to-peer connectivity fails.

## 7. Testing

Minimum tests:

- Deck parser handles quotes, HTML entities, blank counts, and no-blank prompts.
- Reducer tests cover the full round lifecycle.
- Shuffle supports deterministic seeds.
- Browser smoke test covers setup, start, submit, judge, and next round.
- Two-tab WebRTC test uses pasted signaling before adding camera QR scanning.

## Milestones

1. Static TypeScript app scaffold and deck parser.
2. Local game engine and focused tests.
3. One-device playable pass-and-play UI.
4. Static deployment.
5. WebRTC transport prototype using copy/paste signaling.
6. QR-based WebRTC join.
7. Multiplayer polish and reconnect handling.

