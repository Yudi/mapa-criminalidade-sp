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

  formatAddress(boletim: BoletimOcorrencia) {
    const addressParts = [
      boletim.logradouro,
      boletim.numero_logradouro,
      boletim.bairro,
      boletim.cidade,
    ];

    const formattedAddress = addressParts
      .filter((part) => part && part.trim() !== '')
      .join(', ');
    return formattedAddress ? formattedAddress : 'Endereço não disponível';
  }
}
