import { Component, OnInit } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { CountdownService } from '../countdown.service';
import { GameService } from '../game.service';

@Component({
  selector: 'app-game-countdown',
  templateUrl: './game-countdown.component.html',
  styleUrls: ['./game-countdown.component.css'],
})
export class GameCountdownComponent implements OnInit {
  count: number = 0;
  constructor(
    private gameService: GameService,
    private countdownService: CountdownService
  ) {}

  ngOnInit(): void {
    // this.count = this.gameService.count;
    // this.gameService.counter$?.subscribe(
    //   (c) => (this.count = c)
    // );
    this.countdownService.observable$.subscribe((c) => (this.count = c));
  }
}
