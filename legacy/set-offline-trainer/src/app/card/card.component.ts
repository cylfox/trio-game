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
    shading: 0,
    hidden: false,
    selected: false,
  };

  occurrences: number[] = [];
  // @Input() hidden: boolean = false;

  constructor() {
  }

  ngOnInit(): void {
    this.occurrences = Array(this.card.count + 1) as number[];
  }
}
