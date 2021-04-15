import { Component, OnInit } from '@angular/core';
import { Card } from '../card';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-menu',
  templateUrl: './game-menu.component.html',
  styleUrls: ['./game-menu.component.css'],
})
export class GameMenuComponent implements OnInit {
  selectedCards: Card[] = [];

  constructor(private gameService: GameService) {}

  ngOnInit(): void {}

  startGame(): void {
    this.gameService.newGame();
  }

  setFound(): void {
    // this.gameService.pauseGame();
  }

  selectCard(card: Card): void {
    this.selectedCards.push(card);
  }
}
