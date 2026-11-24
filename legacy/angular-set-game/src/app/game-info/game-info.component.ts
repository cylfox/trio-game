import { Component, OnInit } from '@angular/core';
import { Card } from '../card';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-info',
  templateUrl: './game-info.component.html',
  styleUrls: ['./game-info.component.css'],
})
export class GameInfoComponent implements OnInit {
  deck: Card[] = [];
  cardsShown: Card[] = [];
  player1Cards: Card[] = [];
  player2Cards: Card[] = [];
  lostCards: Card[] = [];

  constructor(private gameService: GameService) {}

  ngOnInit(): void {
    this.setupInfo();
  }

  setupInfo() {
    this.gameService.deck.subscribe((cards) => (this.deck = cards));
    this.gameService.cardsShown.subscribe((cards) => (this.cardsShown = cards));
    this.gameService.player1Cards.subscribe((cards) => (this.player1Cards = cards));
    this.gameService.player2Cards.subscribe((cards) => (this.player2Cards = cards));
    this.gameService.lostCards.subscribe((cards) => (this.lostCards = cards));
  }
}
