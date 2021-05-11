import { Component } from '@angular/core';
import { Card, getGameDeck } from './model/card';
import { animate, style, transition, trigger } from '@angular/animations';
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [   // :enter is alias to 'void => *'
        style({ opacity: 0 }),
        animate(100, style({ opacity: 1 }))
      ]),
      transition(':leave', [   // :leave is alias to '* => void'
        animate(200, style({ opacity: 0 }))
      ])
    ])
  ]
})
export class AppComponent {
  title = 'set-offline-trainer';

  deck: Card[] = getGameDeck();
  visibleModal: boolean = false;

  toogleVisibility(card: any) {
    card.hidden = !card.hidden;
  }

  toggleHide() {
    this.deck.forEach(card => card.hidden = !card.hidden);
  }

  toggleModal() {
    this.visibleModal = !this.visibleModal;
  }
}
