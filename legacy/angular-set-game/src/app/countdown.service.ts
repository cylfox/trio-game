import { Injectable } from '@angular/core';
import { Observable, Subject, timer } from 'rxjs';
import { map, repeatWhen, switchMap, take, takeUntil } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class CountdownService {
  // counter$?: Observable<number>;
  count = 60;

  // constructor() { }

  // start(){
  //   this.count = 60;
  //   this.counter$ = timer(0, 1000).pipe(
  //     take(this.count),
  //     map(() => --this.count)
  //   );
  // }

  readonly observable$: Observable<number>;
  private readonly _stop = new Subject<void>();
  private readonly _start = new Subject<void>();

  constructor() {
    this.observable$ = timer(0, 1000).pipe(
      map(() => --this.count),
      take(this.count),
      takeUntil(this._stop),
      repeatWhen(() => this._start)
    );
  }

  start(): void {
    this._start.next();
  }

  stop(): void {
    this._stop.next();
  }
}
