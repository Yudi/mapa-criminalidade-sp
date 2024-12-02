import { Component } from '@angular/core';
import { LicensesComponent } from './components/licenses/licenses.component';

@Component({
  selector: 'app-attribution',
  imports: [LicensesComponent],
  templateUrl: './attribution.component.html',
  styleUrl: './attribution.component.scss',
})
export class AttributionComponent {}
