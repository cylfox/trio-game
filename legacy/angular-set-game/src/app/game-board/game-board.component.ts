import { Component, OnInit } from '@angular/core';
import { take } from 'rxjs/operators';
import { Card } from '../card';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-board',
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.css'],
})
export class GameBoardComponent implements OnInit {
  cardsShown: Card[] = [];
  selectedCards: Card[] = [];
  player1Cards: Card[] = [];
  lostCards: Card[] = [];

  constructor(private gameService: GameService) {}

  ngOnInit(): void {
    // this.gameService.
    this.getCardsShown();
  }

  getCardsShown(): void {
    // this.cardsShown = this.gameService.cardsShown;
    this.gameService
      .getCardsShown()
      .subscribe((cards) => (this.cardsShown = cards));
  }

  // getPlayer1Cards(): void {
  //   // this.cardsShown = this.gameService.cardsShown;
  //   this.gameService.player1Cards.subscribe(
  //     (cards) => (this.player1Cards = cards)
  //   );
  // }

  async selectCard(card: Card) {
    this.selectedCards.push(card);
    console.log(card, this.selectedCards.length);

    if (new Set(this.selectedCards).size === 3) {
      console.log('length === 3', this.selectedCards);

      if (this.gameService.checkSet(this.selectedCards)) {
        console.log('is a set');
        // remove selected cards from table
        const cardsShown = await this.gameService.cardsShown
          .pipe(take(1))
          .toPromise();
        this.gameService.cardsShown.next(
          this.gameService.removeSetFromDeck(this.selectedCards, cardsShown)
        );
        // adds the cards to the player deck
        const player1Cards = await this.gameService.player1Cards
          .pipe(take(1))
          .toPromise();

        const newPlayer1Cards = player1Cards.concat(this.selectedCards);
        this.gameService.player1Cards.next(newPlayer1Cards);

        // add new cards from the deck to the table

        let deck = await this.gameService.deck.pipe(take(1)).toPromise();
        const newCards = deck.splice(0, 3);

        this.gameService.deck.next(deck);
        const cardsShown2 = await this.gameService.cardsShown
          .pipe(take(1))
          .toPromise();
        this.gameService.cardsShown.next(cardsShown2.concat(newCards));
      } else {
        console.log('is not a set');
        // removes a set from the player deck
        let player1Cards = await this.gameService.player1Cards
          .pipe(take(1))
          .toPromise();
        const lostCards = player1Cards.splice(0, 3);
        this.gameService.player1Cards.next(player1Cards);

        // add the set to the lost cards
        const allLostCards = await this.gameService.lostCards
          .pipe(take(1))
          .toPromise();
        this.gameService.lostCards.next(allLostCards.concat(lostCards));
      }
      // empty the selection
      this.selectedCards = [];
    } else {
      console.log('must be three different cards');
      // empty the selection
      this.selectedCards = [];
    }
  }
}
