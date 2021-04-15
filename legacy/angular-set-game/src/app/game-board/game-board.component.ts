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

    if (this.selectedCards.length === 3) {
      console.log('length === 3');

      if (this.gameService.checkSet(this.selectedCards)) {
        console.log('is a set');
        // const deck = await this.gameService.deck.pipe(take(1)).toPromise();
        // const newDeck = this.gameService.removeSetFromDeck(
        //   this.selectedCards,
        //   deck
        // );
        const cardsShown = await this.gameService.cardsShown.pipe(take(1)).toPromise();
        const newDeck = this.gameService.removeSetFromDeck(
          this.selectedCards,
          cardsShown
        );
        console.log(
          'this.selectedCards',
          this.selectedCards,
          'newdeck',
          newDeck
        );

        this.gameService.cardsShown.next(newDeck);
        // adds the cards to the player deck
        const player1Cards = await this.gameService.player1Cards
          .pipe(take(1))
          .toPromise();

        const newPlayer1Cards = player1Cards.concat(this.selectedCards);
        this.gameService.player1Cards.next(newPlayer1Cards);
      } else {
        console.log('is not a set');
        // removes a set from the player deck
        let player1Cards = await this.gameService.player1Cards
          .pipe(take(1))
          .toPromise();
        player1Cards.splice(0, 3);
        this.gameService.player1Cards.next(player1Cards);
      }
      // empty the selection
      this.selectedCards = [];
    }
  }
}
