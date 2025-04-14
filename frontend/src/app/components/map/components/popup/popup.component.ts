import { Component, EventEmitter, Input, Output } from '@angular/core';
import { BoletimOcorrencia } from '../../../../shared/schema.interface';

@Component({
  selector: 'app-popup',
  templateUrl: './popup.component.html',
  styleUrl: './popup.component.scss',
})
export class PopupComponent {
  @Input({ required: true }) boletins: BoletimOcorrencia[] = [];
  @Output() close = new EventEmitter<void>();

  index = 0;

  get boletim(): BoletimOcorrencia | null {
    return this.boletins[this.index] ?? null;
  }

  next() {
    if (this.index < this.boletins.length - 1) {
      this.index++;
    }
  }

  prev() {
    if (this.index > 0) {
      this.index--;
    }
  }
}
