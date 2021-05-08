import { Component } from '@angular/core';
import { getGameDeck } from './model/card';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'set-offline-trainer';

  deck = getGameDeck();

  toogleVisibility(card: any) {
    card.hidden = !card.hidden;
  }
}
