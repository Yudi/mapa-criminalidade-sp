import { Component } from '@angular/core';
import { LucideAngularModule, Info } from 'lucide-angular';
import { MatToolbar } from '@angular/material/toolbar';

@Component({
  selector: 'app-toolbar',
  imports: [LucideAngularModule, MatToolbar],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
})
export class ToolbarComponent {
  readonly Info = Info;
}
