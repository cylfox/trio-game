import { Component, OnInit } from '@angular/core';
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

  selectCard(card: Card) {
    this.selectedCards.push(card);
    if (this.selectedCards.length === 3) {
      if (this.gameService.checkSet(this.selectedCards)) {
        // adds the cards to the player deck
        this.gameService.player1Cards = this.gameService.player1Cards.concat(
          this.selectedCards
        );
      } else {
        // removes a set from the player deck
        this.gameService.player1Cards.splice(0, 3);
      }
      // empty the selection
      this.selectedCards = [];
    }
  }
}
