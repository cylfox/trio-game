import { Component, OnInit } from '@angular/core';
import { timer } from 'rxjs';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';

@Component({
  selector: 'app-game-countdown',
  templateUrl: './game-countdown.component.html',
  styleUrls: ['./game-countdown.component.css'],
})
export class GameCountdownComponent {
  counter$: Observable<number>;
  count = 60;

  constructor() {
    this.counter$ = timer(0, 1000).pipe(
      take(this.count),
      map(() => --this.count)
    );
  }
}
