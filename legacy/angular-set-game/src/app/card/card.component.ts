import { Component, Input, OnInit } from '@angular/core';
import { Card } from '../card';

@Component({
  selector: 'app-card',
  templateUrl: './card.component.html',
  styleUrls: ['./card.component.css'],
})
export class CardComponent implements OnInit {
  @Input() card?: Card;

  constructor() {}

  ngOnInit(): void {}

  fillArray(n: number) {
    return Array.from(Array(n), (x, i) => i);
  }

  getCardStyle(card: Card) {
    let className = ['padding'];
    
    if (card.shape === 0) {
      className.push('triangle');
    } else if (card.shape === 1) {
      className.push('square');
    } else {
      className.push('circle');
    }

    if (card.background === 2) {
      if (card.color === 0) {
        className.push('striped-red border-red');
      } else if (card.shape === 1) {
        className.push('striped-blue border-blue');
      } else {
        className.push('striped-green border-green');
      }
    } else if (card.background === 1) {
      if (card.color === 0) {
        className.push('border-red white');
      } else if (card.shape === 1) {
        className.push('border-blue white');
      } else {
        className.push('border-green white');
      }
    } else {
      if (card.color === 0) {
        className.push('red');
      } else if (card.shape === 1) {
        className.push('blue');
      } else {
        className.push('green');
      }
    }

    return className.join(' ');
  }
}
