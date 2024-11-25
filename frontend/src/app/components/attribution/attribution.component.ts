import { Component } from '@angular/core';
import { SvgAttributionComponent } from './components/svg/svg-attribution.component';

@Component({
  selector: 'app-attribution',
  imports: [SvgAttributionComponent],
  templateUrl: './attribution.component.html',
  styleUrl: './attribution.component.scss',
})
export class AttributionComponent {}
