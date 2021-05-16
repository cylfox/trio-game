import { Component, OnInit } from '@angular/core';
import { Card, getGameDeck } from '../model/card';

@Component({
  selector: 'app-test',
  templateUrl: './test.component.html',
  styleUrls: ['./test.component.scss']
})
export class TestComponent implements OnInit {

  card?: Card;

  constructor() { }

  ngOnInit(): void {
    this.card = getGameDeck()[0];
  }

}
