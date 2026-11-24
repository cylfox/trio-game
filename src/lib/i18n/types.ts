import type { CardNames } from '../engine/engine.ts';

/** A message that varies with a `count` param (Intl.PluralRules categories). */
export interface Plural {
  readonly one: string;
  readonly other: string;
  readonly zero?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
}

export type Message = string | Plural;

/** Builds a card's accessible name ("2 green striped squiggles") with the language's grammar. */
export type CardLabeler = (card: CardNames) => string;
