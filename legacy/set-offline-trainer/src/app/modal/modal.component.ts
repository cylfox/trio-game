
import { EventEmitter } from '@angular/core';
import { Component, OnInit, Output } from '@angular/core';

@Component({
  selector: 'app-modal',
  templateUrl: './modal.component.html',
  styleUrls: ['./modal.component.scss'],
})
export class ModalComponent implements OnInit {

  @Output() onClose = new EventEmitter();

  constructor() { }

  ngOnInit(): void {
  }

  toggleVisibility(event: Event) {
    const className = (event.target as Element).className;
    if (className === 'background' || className === 'btn-close')
      this.onClose.emit();
  }
}
