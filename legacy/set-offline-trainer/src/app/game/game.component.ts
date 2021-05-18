import { Component, OnInit } from '@angular/core';
import { Card, getGameDeck } from '../model/card';
import { animate, style, transition, trigger } from '@angular/animations';

@Component({
  selector: 'app-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss'],
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [
        // :enter is alias to 'void => *'
        style({ opacity: 0 }),
        animate(100, style({ opacity: 1 })),
      ]),
      transition(':leave', [
        // :leave is alias to '* => void'
        animate(200, style({ opacity: 0 })),
      ]),
    ]),
  ],
})
export class GameComponent implements OnInit {

  constructor() { }

  ngOnInit(): void {
  }

  cardDeck: Card[] = getGameDeck();
  cardsDisplayed: Card[] = [];
  cardsWon: Card[] = [];
  cardsLost: Card[] = [];

  visibleModal: boolean = false;

  newGame() {
    this.cardDeck = getGameDeck();

    // hide displayed cards

    this.cardsDisplayed = this.cardDeck.splice(0, 12);

    // remove transition from card element first ?
    // translate each card to the deck position
    // show displayed cards
    // translate back where they were

    this.cardsWon = this.cardDeck.splice(0, 24);
    this.cardsLost = this.cardDeck.splice(0, 6);


    console.log(this.cardDeck, this.cardsDisplayed);
  }

  toogleVisibility(card: Card) {
    card.hidden = !card.hidden;
  }
  toogleSelection(card: Card) {
    card.selected = !card.selected;
    console.warn('==> selected', card);

  }

  toggleHide() {
    this.cardDeck.forEach((card) => (card.hidden = !card.hidden));
  }

  toggleModal() {
    this.visibleModal = !this.visibleModal;
  }

  lastElement: any;

  showPosition(event: MouseEvent) {
    // obtener el elemento de la carta seleccionada
    const el: HTMLElement = (event.target as HTMLElement);

    // obtener el elemento .card padre de la carta seleccionada
    const card: HTMLElement | null = el.closest('.card');
    if (!card) return;
    let currElement: HTMLElement = card;

    // obtenemos la posicion x e y respecto al viewport
    const rectCurr = currElement.getBoundingClientRect();

    // comprobamos si existe una última posición conocida
    // si no registramos la del elemento seleccionado
    if (!this.lastElement)
      this.lastElement = {
        x: rectCurr.x,
        y: rectCurr.y,
      };

    // calculamos la posición en la que debería de estar
    const x = this.lastElement.x - rectCurr.x;
    const y = this.lastElement.y - rectCurr.y;

    // realizamos la translacion
    currElement.style.transform = `translate(${x}px,${y}px)`;

    // actualizamos la última posición conocida
    this.lastElement = {
      x: rectCurr.x,
      y: rectCurr.y,
    };
  }
}
