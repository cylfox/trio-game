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

  cardDeck: Card[] = getGameDeck();
  cardsDisplayed: Card[] = [];
  cardsWon: Card[] = [];
  cardsLost: Card[] = [];

  visibleModal: boolean = false;

  newGame() {
    this.cardDeck = getGameDeck();
    this.cardsDisplayed = this.cardDeck.splice(0, 12);
    this.cardsWon = this.cardDeck.splice(0, 24);;
    this.cardsLost = this.cardDeck.splice(0, 6);;

    console.log(this.cardDeck, this.cardsDisplayed);

  }

  toogleVisibility(card: any) {
    card.hidden = !card.hidden;
  }

  toggleHide() {
    this.cardDeck.forEach(card => card.hidden = !card.hidden);
  }

  toggleModal() {
    this.visibleModal = !this.visibleModal;
  }
}
