import { Component, OnInit } from '@angular/core';
import { Card } from '../card';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-board',
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.css']
})
export class GameBoardComponent implements OnInit {
  cardsShown: Card[] = [];

  constructor(private gameService: GameService) { }

  ngOnInit(): void {
    // this.gameService.
    this.getCardsShown();
  }

  getCardsShown(): void {
    // this.cardsShown = this.gameService.cardsShown;
    this.gameService.getCardsShown().subscribe(cards => this.cardsShown = cards);
  }

}
