import { shuffle } from "../utils/shuffle";

export interface Card {
  id: number;
  shape: number;
  color: number;
  count: number;
  background: number;
  hidden: boolean;
  selected: boolean;
}

/**
 * Generates a new deck of cards shuffled.
 * @returns Card[].
 */
export function getGameDeck() {
  let deck: Card[] = [];
  const variations = 3;
  let id = 0;

  for (let i = 0; i < variations; i++) {
    for (let j = 0; j < variations; j++) {
      for (let k = 0; k < variations; k++) {
        for (let h = 0; h < variations; h++) {
          deck.push({
            id: id++,
            shape: i,
            color: j,
            count: k,
            background: h,
            hidden: true,
            selected: false,
          } as Card);
        }
      }
    }
  }
  shuffle(deck);
  return deck;
}
