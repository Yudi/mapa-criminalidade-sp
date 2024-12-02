import { Component, inject, Input, WritableSignal } from '@angular/core';
import { LucideAngularModule, Info as InfoIcon } from 'lucide-angular';
import { MatToolbar, MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AttributionComponent } from '../attribution/attribution.component';
import {
  MatIcon,
  MatIconModule,
  MatIconRegistry,
} from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-toolbar',
  imports: [
    LucideAngularModule,
    MatToolbarModule,
    MatProgressBar,
    MatDialogModule,
    MatIcon,
    MatButtonModule,
  ],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  readonly dialog = inject(MatDialog);

  @Input({ required: true })
  showIndeterminateProgressBar!: WritableSignal<boolean>;
  @Input({ required: true }) progressBarPercentage!: WritableSignal<number>;
  readonly InfoIcon = InfoIcon;

  constructor() {
    const sanitizer = inject(DomSanitizer);
    const iconRegistry = inject(MatIconRegistry);
    iconRegistry.addSvgIcon(
      'info',
      sanitizer.bypassSecurityTrustResourceUrl('icons/info.svg'),
    );
  }

  displayInfoModal() {
    this.dialog.open(AttributionComponent);
  }
}
