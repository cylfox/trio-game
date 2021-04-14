import { Component, OnInit } from '@angular/core';
import { Card, getDeck } from '../card';

@Component({
  selector: 'app-game-board',
  templateUrl: './game-board.component.html',
  styleUrls: ['./game-board.component.css']
})
export class GameBoardComponent implements OnInit {
  deck: Card[] = [];
  
  constructor() { }

  ngOnInit(): void {
    this.deck = getDeck();
  }

}
