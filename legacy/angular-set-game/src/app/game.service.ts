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
import { Card, getFullDeck } from './card';
import { CountdownService } from './countdown.service';

@Injectable({
  providedIn: 'root',
})
export class GameService {
  deck: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  cardsShown: BehaviorSubject<Card[]> = new BehaviorSubject<Card[]>([]);
  player1Cards: Card[] = [];
  player2Cards: Card[] = [];
  lostCards: Card[] = [];

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

    this.cardsShown.next(deck.splice(0, 12));
    this.deck.next(deck);
    // console.log('shown', this.cardsShown);

    // this.setupCountdown();
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
}
