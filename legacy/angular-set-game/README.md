# Angular Set Game

A playable single-player version of the [Set](https://en.wikipedia.org/wiki/Set_(card_game)) card game, built with Angular 11. The cards are drawn with plain CSS shapes.

For a later rewrite that focuses on visuals (SVG card symbols, deal and flip animations, modals), see [set-offline-trainer](https://github.com/cylfox/set-offline-trainer). That one isn't finished; this repo is the version you can actually play.

## How the game works

The deck has 81 cards: every combination of four features, each with three values.

| Feature | Values |
| ------- | ------ |
| Shape   | triangle, square, circle |
| Colour  | red, blue, green |
| Number  | one, two, three |
| Fill    | solid, outlined, striped |

Three cards make a **set** if, for each feature on its own, they're either all the same or all different.

In this implementation:

- **New game** shuffles the deck and deals 12 cards.
- Click three cards to select them:
  - **Valid set**: the cards go to your won pile. If fewer than 12 cards are left on the table, 3 more are dealt from the deck.
  - **Not a set**: as a penalty, 3 cards move from your won pile to the lost pile.
  - Clicking the same card twice just clears the selection.
- **Add another row** deals 3 extra cards when you can't find a set.
- An info panel shows the cards left in the deck, the cards on the table, and your won and lost cards.

## Project structure

- `game.service.ts`: deck, table and pile state (RxJS `BehaviorSubject`s), shuffling, set validation (`checkSet`) and a brute-force set finder (`findSet`)
- `game-board`: the table and card selection
- `card`: renders one card
- `game-menu`: the New game and Add another row buttons
- `game-info`: the pile counters
- `game-countdown` + `countdown.service.ts`: a 60-second RxJS countdown

## Getting started

```bash
npm install
npm start      # ng serve, http://localhost:4200
npm run build
npm test       # Karma unit tests
npm run lint
npm run e2e    # Protractor
```

## Status and notes

- The countdown and the Find SET hint are written but switched off: their elements are commented out in `game-menu.component.html`. When called, `findSet` only logs the set it found to the console.
- There's no end-of-game detection, and the player 2 pile isn't used.
