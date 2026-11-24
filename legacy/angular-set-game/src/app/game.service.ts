import { Injectable } from '@angular/core';
import {
  Observable,
  of,
  from,
  BehaviorSubject,
  Subscription,
  timer,
} from 'rxjs';
import { catchError, map, take, tap } from 'rxjs/operators';
import { BoardCard, Card, getFullDeck } from './card';
import { CountdownService } from './countdown.service';

@Injectable({
  providedIn: 'root',
})
export class GameService {
  deck: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  cardsShown: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  player1Cards: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  player2Cards: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  lostCards: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);

  counter$?: Observable<number>;
  // counter$?: Subscription;
  count: number = 0;

  constructor(private countdownService: CountdownService) {
    this.setupCountdown();
  }

  newGame() {
    let deck = getFullDeck();
    console.log('deck', deck);

    this.shuffleArray(deck);
    // console.log('deck shuffled', deck);
    const cardsShown = deck.splice(0, 12);

    this.cardsShown.next(cardsShown);
    this.deck.next(deck);
    // console.log('shown', this.cardsShown);

    // this.setupCountdown();
    console.log("SET", this.findSet(cardsShown));

  }

  async addRowOfCards() {
    let deck = await this.deck.pipe(take(1)).toPromise();
    let cardsShown = await this.cardsShown.pipe(take(1)).toPromise();

    this.cardsShown.next(cardsShown.concat(deck.splice(0, 3)));
    this.deck.next(deck);
  }

  shuffleArray(array: any) {
    // https://stackoverflow.com/questions/2450954/how-to-randomize-shuffle-a-javascript-array
    // The new ES6 allows us to assign two variables at once. This is especially
    // handy when we want to swap the values of two variables, as we can do it in one
    // line of code. Here is a shorter form of the same function, using this feature.
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  getCardsShown(): BehaviorSubject<Card[]> {
    return this.cardsShown;
  }

  setupCountdown() {
    // this.count = 60;
    // this.counter$ = timer(0, 1000).pipe(
    //   take(this.count),
    //   map(() => --this.count),
    //   tap(() => console.log('estoy ejecutandome'))
    // );
    // this.countdownService.start();
    // this.counter$ = this.countdownService.counter$?.subscribe(
    //   (c) => (this.count = c)
    // );
  }

  // stopCountdown() {
  //   this.counter$?.unsubscribe();
  // }

  checkSet(set: Card[]) {
    /*
      SET: tres cartas forman un SET si, respecto a cada una de las
      cuatro características (forma, color, número y fondo), evaluadas
      una a una, las tres cartas son iguales o las tres son diferentes.
    */
    if (set.length === 3) {
      const shapes = this.uniqueOrEqual(set.map((card) => card.shape));
      const color = this.uniqueOrEqual(set.map((card) => card.color));
      const count = this.uniqueOrEqual(set.map((card) => card.count));
      const background = this.uniqueOrEqual(set.map((card) => card.background));

      console.log(shapes, color, count, background);
      console.log(shapes && color && count && background);

      return shapes && color && count && background;
    } else {
      return false;
    }
  }

  private uniqueOrEqual(array: any) {
    console.log('as', array);

    const set = new Set(array);
    return set.size === 1 || set.size === array.length ? true : false;
  }

  removeSetFromDeck(set: Card[], deck: Card[]) {
    return deck.filter((card) => !set.map((c) => c.id).includes(card.id));
  }

  findSet(cardsShown: Card[]) {
    for (let i = 0; i < cardsShown.length; i++) {
      for (let j = 0; j < cardsShown.length; j++) {
        for (let k = 0; k < cardsShown.length; k++) {
          if (i !== j && i !== k && j !== k) {
            let set: Card[] = [];
            set.push(cardsShown[i]);
            set.push(cardsShown[j]);
            set.push(cardsShown[k]);

            if (this.checkSet(set)) return set;
          }
        }
      }
    }
    return [];
  }
}
