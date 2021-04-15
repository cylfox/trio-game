import { Component, OnInit } from '@angular/core';
import { Card } from '../card';
import { CountdownService } from '../countdown.service';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-menu',
  templateUrl: './game-menu.component.html',
  styleUrls: ['./game-menu.component.css'],
})
export class GameMenuComponent implements OnInit {
  selectedCards: Card[] = [];

  constructor(
    private gameService: GameService,
    private countdownService: CountdownService
  ) {}

  ngOnInit(): void {
    this.countdownService.stop();
  }

  startGame(): void {
    this.gameService.newGame();
    this.countdownService.start();
  }

  setFound(): void {
    // this.gameService.pauseGame();
    this.countdownService.stop();
  }

  selectCard(card: Card): void {
    this.selectedCards.push(card);
  }
}
