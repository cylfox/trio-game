# Set Offline Trainer

An unfinished Angular 11 rewrite of the [Set](https://en.wikipedia.org/wiki/Set_(card_game)) card game that focuses on how the cards look and move: SVG card symbols, a card back, deal and flip animations, and a modal.

The playable version, with set validation, scoring and dealing extra rows, is [angular-set-game](https://github.com/cylfox/angular-set-game). This repo reworks the presentation and doesn't have game logic yet.

## The cards

As in the real game, the deck has 81 cards: every combination of four features with three values each.

| Feature | Values |
| ------- | ------ |
| Shape   | diamond, squiggle, oval |
| Colour  | red, green, purple |
| Number  | one, two, three |
| Shading | solid, striped, open |

Three cards form a set if each feature is either all the same or all different across them. This repo doesn't check sets yet; that logic lives in angular-set-game.

## What's implemented

- **SVG symbols**: a solid, striped and open version of each shape (`src/assets/*.svg`, from the PSD sources in `src/assets/psd`), recoloured with CSS filters. There's also a card back with the SET logo.
- **Card component**: a 3D flip between front and back, and a highlight for selected cards.
- **Game screen** (`/game`):
  - **New Game** shuffles the deck and deals 12 cards face down. They slide in from the top and flip face up after about 1.7 s.
  - Clicking a card toggles its selection.
  - A sidebar shows the deck, won and lost counts. For now, New Game fills the won and lost piles with placeholder cards from the deck.
  - **Toggle Hide** flips the cards that are still in the deck.
  - **Toggle Modal** opens a modal that fades in and out (Angular animations) and closes from its button or by clicking the backdrop.
- **Test screen** (`/test`): renders a single random card.

## Getting started

```bash
npm install
npm start      # ng serve, then open http://localhost:4200/game
npm run build
npm test       # Karma unit tests
npm run lint
npm run e2e    # Protractor
```

The root route (`/`) has no component, so it shows a blank page.

## Status

Unfinished. The layout still has placeholder header and aside areas, and there's no set checking, scoring or end of game. `GameComponent.showPosition` is an experiment for moving a card to another card's position with CSS transforms, and isn't wired up in the template.
