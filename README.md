# Trio

A phone-first card game of spotting sets, for two players online or one in training. It's a static site on GitHub Pages: no server and no accounts. Phones connect to each other directly over WebRTC.

**Play:** <https://cylfox.github.io/trio-game/>

> The current screen is a temporary debug UI. The real game screen is being designed separately.

## Rules

There are 81 cards, and each has four features: shape, colour, number and shading. Three cards form a **set** when every feature is either the same on all three or different on all three. Twelve cards are dealt. When the board has no set, three more are added automatically.

### Versus (online, 2 players)

- **Call first.** Press **SET!** to take the call. While you hold it, the other phone freezes and shows your countdown. If both players press at once, the host's phone decides by arrival order.
- **Pick 3 cards within 5 seconds.**
  - A valid set scores **+3**.
  - A wrong pick, or running out of time, costs **3** if you have 3 or more points, otherwise **1**.
  - Scores can go negative. Example: 0 → +3 → 3 → wrong → 0 → wrong → −1 → timeout → −2 → +3 → 1.
- Penalties never take cards back. Your pile keeps every set you found.
- The game ends when the deck is empty and no set is left on the board. Then both players can ask for a rematch.

### Train (solo, offline)

Train is for practising reaction time, so it uses the same flow: press **SET!**, then pick. Nothing is scored. Wrong picks count as mistakes and expired calls as timeouts. You can turn off the time limit. Hints show one card of a valid set, and each hint is counted.

Every call is recorded with its timings:

- **Pick time**: from the call to the pick.
- **Gap**: from your previous result to this call. The UI subtracts its animation time from the gap to get the spot time.

## Play online

1. Tap **Create room**. You get a 4-character code such as `K7QX` (no 0/O/1/I/L) and an invite link: `https://cylfox.github.io/trio-game/#K7QX`.
2. Your friend opens the link, or types the code under **Join with code**.
3. The host taps **Start game**.

The room creator is the **host**, and their phone runs the game. The other phone only sends what its player does.

- **Rejoining:** the host saves the room after every change. If the host reloads or reopens the tab, the room resumes. If a guest drops, they get their seat and score back when they reconnect.
- **Room full:** a third person who opens the link sees "Room full".
- **Language:** the app is in English and Spanish. It picks one from your browser settings, and you can switch in the app.

### Network caveat

Trystero uses public Nostr relays only to introduce the two phones. After that, game data goes directly from phone to phone. Most home and mobile networks allow this. Some strict networks don't, such as certain mobile carriers (CGNAT), corporate or university Wi-Fi, and some VPNs. On those, the phones find each other but can't connect. That needs a **TURN relay** server: pass `turn` to `createTrysteroTransport` in `src/lib/net/trystero-transport.ts`.

## Development

Requires Node 24 or newer.

```sh
git clone https://github.com/cylfox/trio-game.git
cd trio-game
npm ci
npm run dev       # http://localhost:5173/trio-game/
npm test          # engine, protocol, i18n and symbol tests (node --test)
npm run check     # svelte-check + tsc, strict
npm run build     # production build into dist/
npm run preview   # serve dist/ at /trio-game/
npm run symbols   # regenerate src/lib/symbol-data.ts from assets/pixel-symbols.json
npm run icons     # regenerate the icons in public/ (dev-only; the outputs are committed)
```

Stack: Vite, Svelte 5, TypeScript (strict), Tailwind CSS v4 and Trystero. Pushing to `main` deploys to Pages through `.github/workflows/deploy.yml`.

| Path | What |
|---|---|
| `src/lib/engine/` | The game engine. It's pure, with no dependencies, and time is passed in. Every change returns `{state, events}`. |
| `src/lib/net/` | Rooms, the host/guest protocol, the `Transport` interface with Trystero and in-memory versions, and storage. |
| `src/lib/i18n/` | Every user-visible string: `en.ts` is the source, and `es.ts` must have the same keys. |
| `src/lib/symbols.ts` | The pixel-art card symbol renderer (26×13 grids). |
| `src/debug/` | The temporary debug screen. |

To test with two players on one computer, open `http://localhost:5173/trio-game/` and `http://127.0.0.1:5173/trio-game/`. They're different origins, so each gets its own player id. Real phones need HTTPS, because WebRTC signalling uses WebCrypto, so test those on the Pages deployment.

## Legacy

`legacy/` holds the two earlier Angular versions, `angular-set-game` and `set-offline-trainer`, with their history. They are kept for reference only. The build, type check, tests and Tailwind all ignore that folder.
