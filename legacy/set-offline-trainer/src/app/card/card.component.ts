import { Component, Input, OnInit } from '@angular/core';
import { Card } from '../model/card';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.scss']
})
export class CardComponent implements OnInit {

  @Input() card: Card = {
    id: 0,
    shape: 0,
    color: 0,
    count: 0,
    background: 0,
    hidden: false,
    selected: false,
  };
  // @Input() hidden: boolean = false;

  constructor() {
  }

  ngOnInit(): void { }
}
