import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { GameBoardComponent } from './game-board/game-board.component';
import { CardComponent } from './card/card.component';
import { GameMenuComponent } from './game-menu/game-menu.component';

@NgModule({
  declarations: [
    AppComponent,
    GameBoardComponent,
    CardComponent,
    GameMenuComponent
  ],
  imports: [
    BrowserModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
