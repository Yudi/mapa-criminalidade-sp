import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';

@Component({
  selector: 'app-tile-timeout-dialog',
  imports: [MatButtonModule, MatDialogModule],
  styleUrl: './tile-timeout-dialog.component.scss',
  template: `
    <h2 mat-dialog-title>Consulta demorou demais</h2>

    <mat-dialog-content>
      <p>
        A consulta ao mapa excedeu o tempo limite. Alguns pontos podem não ter
        sido carregados nesta visualização.
      </p>
      <p>
        Tente aproximar o mapa, reduzir os filtros ou aguardar alguns instantes
        antes de tentar novamente.
      </p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton="filled" type="button" (click)="close()">OK</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TileTimeoutDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<TileTimeoutDialogComponent>);

  close(): void {
    this.dialogRef.close();
  }
}
