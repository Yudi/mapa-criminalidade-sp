import { Component, EventEmitter, Input, input, Output } from '@angular/core';
import { BoletimOcorrencia } from '../../../../shared/schema.interface';

@Component({
  selector: 'app-popup',
  imports: [],
  templateUrl: './popup.component.html',
  styleUrl: './popup.component.scss',
})
export class PopupComponent {
  @Input({ required: true }) boletim!: BoletimOcorrencia;
  @Output() close = new EventEmitter<void>();
}
