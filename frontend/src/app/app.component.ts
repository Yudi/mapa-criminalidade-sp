import { Component, inject, PLATFORM_ID } from '@angular/core';
import { CardComponent } from './components/card/card.component';
import { ToolbarComponent } from './components/toolbar/toolbar.component';
import { MapComponent } from './components/map/map.component';

import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-root',
  imports: [CardComponent, ToolbarComponent, MapComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'frontend';
  private platformId = inject(PLATFORM_ID);

  get isBrowserOnly(): boolean {
    return isPlatformBrowser(this.platformId);
  }
}
