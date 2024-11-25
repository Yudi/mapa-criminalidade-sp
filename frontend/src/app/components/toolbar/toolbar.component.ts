import { Component, Input, WritableSignal } from '@angular/core';
import { LucideAngularModule, Info } from 'lucide-angular';
import { MatToolbar } from '@angular/material/toolbar';
import { MatProgressBar } from '@angular/material/progress-bar';

@Component({
  selector: 'app-toolbar',
  imports: [LucideAngularModule, MatToolbar, MatProgressBar],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  @Input({ required: true })
  showIndeterminateProgressBar!: WritableSignal<boolean>;
  @Input({ required: true }) progressBarPercentage!: WritableSignal<number>;
  readonly Info = Info;
}
