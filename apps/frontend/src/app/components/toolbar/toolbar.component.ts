import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  Signal,
  WritableSignal,
} from '@angular/core';
import { MatToolbar } from '@angular/material/toolbar';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

@Component({
  selector: 'app-toolbar',
  imports: [
    MatToolbar,
    MatProgressBar,
    MatIcon,
    MatIconButton,
  ],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolbarComponent {
  readonly dialog = inject(MatDialog);

  @Input({ required: true })
  showIndeterminateProgressBar!: Signal<boolean>;
  @Input({ required: true }) progressBarPercentage!: WritableSignal<number>;

  async displayInfoModal(): Promise<void> {
    const { AttributionComponent } = await import(
      '../attribution/attribution.component'
    );

    this.dialog.open(AttributionComponent);
  }
}
