import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
  OnInit,
  DestroyRef,
} from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import {
  MapFeatureResponse,
  CelularRecord,
  VeiculoRecord,
  ObjetoRecord,
  isCelularRecord,
  isVeiculoRecord,
  isObjetoRecord,
  isProdutividadeArmasRecord,
  isProdutividadeEntorpecentesRecord,
  isProdutividadeVeiculosRecord,
  isProdutividadePessoaRecord,
  ProdutividadeArmasRecord,
  ProdutividadeEntorpecentesRecord,
  ProdutividadeVeiculosRecord,
  ProdutividadePessoaRecord,
} from '@mapa-criminalidade/shared-types';
import { OccurrencesService } from '../../../../shared/occurrences.service';

export interface FeatureDetailDialogData {
  numBo: string;
  anoBo: number;
  /** Registration police unit, required to disambiguate pre-2022 BO numbers. */
  delegacia?: string | null;
}

@Component({
  selector: 'app-feature-detail-dialog',
  templateUrl: './feature-detail-dialog.component.html',
  styleUrl: './feature-detail-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatCardModule
  ],
})
export class FeatureDetailDialogComponent implements OnInit {
  private readonly occurrencesService = inject(OccurrencesService);
  private readonly dialogRef = inject(
    MatDialogRef<FeatureDetailDialogComponent>
  );
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<FeatureDetailDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly feature = signal<MapFeatureResponse | null>(null);
  readonly celulares = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(isCelularRecord) as CelularRecord[];
  });

  readonly veiculos = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(isVeiculoRecord) as VeiculoRecord[];
  });

  readonly objetos = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(isObjetoRecord) as ObjetoRecord[];
  });

  readonly armas = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(
      isProdutividadeArmasRecord
    ) as ProdutividadeArmasRecord[];
  });

  readonly entorpecentes = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(
      isProdutividadeEntorpecentesRecord
    ) as ProdutividadeEntorpecentesRecord[];
  });

  readonly veiculosRecuperados = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(
      isProdutividadeVeiculosRecord
    ) as ProdutividadeVeiculosRecord[];
  });

  readonly pessoas = computed(() => {
    const f = this.feature();
    if (!f) return [];
    return f.featureData.records.filter(
      isProdutividadePessoaRecord
    ) as ProdutividadePessoaRecord[];
  });
  readonly imlRecords = computed(() => this.feature()?.imlRecords ?? []);

  readonly hasVeiculos = computed(() => this.veiculos().length > 0);
  readonly hasCelulares = computed(() => this.celulares().length > 0);
  readonly hasObjetos = computed(() => this.objetos().length > 0);
  readonly hasArmas = computed(() => this.armas().length > 0);
  readonly hasEntorpecentes = computed(() => this.entorpecentes().length > 0);
  readonly hasVeiculosRecuperados = computed(
    () => this.veiculosRecuperados().length > 0
  );
  readonly hasPessoas = computed(() => this.pessoas().length > 0);
  readonly hasImlRecords = computed(() => this.imlRecords().length > 0);

  ngOnInit(): void {
    this.loadFeature();
  }

  private loadFeature(): void {
    this.occurrencesService
      .getFullFeature(this.data.numBo, this.data.anoBo, this.data.delegacia)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (feature) => {
          if (!feature) {
            this.error.set('Ocorrência não encontrada');
            this.loading.set(false);
            return;
          }

          this.feature.set(feature);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('Error loading feature:', err);
          this.error.set('Erro ao carregar dados da ocorrência');
          this.loading.set(false);
        },
      });
  }

  close(): void {
    this.dialogRef.close();
  }

  formatDate(date: Date | string | null | undefined): string {
    if (!date) return 'N/A';

    if (date instanceof Date) {
      return this.formatDateObject(date, String(date));
    }

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return `${day}/${month}/${year}`;
    }

    const parsedDate = new Date(date);
    return this.formatDateObject(parsedDate, date);
  }

  formatTime(time: Date | string | null | undefined): string {
    if (!time) return '';

    if (time instanceof Date) {
      return this.formatTimeParts(time.getHours(), time.getMinutes());
    }

    const normalizedTimeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
    if (normalizedTimeMatch) {
      const [, hours, minutes] = normalizedTimeMatch;
      return `${hours.padStart(2, '0')}:${minutes}`;
    }

    const parsedTime = new Date(time);
    if (!Number.isNaN(parsedTime.getTime())) {
      return this.formatTimeParts(
        parsedTime.getHours(),
        parsedTime.getMinutes()
      );
    }

    return time;
  }

  formatImlDate(value: string | null | undefined): string {
    if (!value) return 'N/A';

    const match =
      /^(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2})(?::\d{2})?)?$/.exec(
        value
      );
    if (!match) return value;

    return match[2] ? `${match[1]} às ${match[2]}` : match[1];
  }

  formatOccurrenceTime(time: Date | string | null | undefined): string {
    if (!time) return '';

    if (this.isClockTimeValue(time)) {
      return this.formatTime(time);
    }

    return this.formatPeriodLabel(String(time));
  }

  getOccurrenceTimeLabel(time: Date | string | null | undefined): string {
    if (!time) return '';

    return this.isClockTimeValue(time) ? 'às' : 'Período:';
  }

  formatAddress(): string {
    const f = this.feature();
    if (!f) return '';

    const loc = f.featureData.location;
    const parts = [loc.logradouro, loc.numero, loc.bairro, loc.cidade].filter(
      Boolean
    );

    return parts.join(', ') || 'Endereço não disponível';
  }

  private formatDateObject(date: Date, fallback: string): string {
    if (Number.isNaN(date.getTime())) return fallback;

    return date.toLocaleDateString('pt-BR');
  }

  private formatTimeParts(hours: number, minutes: number): string {
    const paddedHours = String(hours).padStart(2, '0');
    const paddedMinutes = String(minutes).padStart(2, '0');
    return `${paddedHours}:${paddedMinutes}`;
  }

  private isClockTimeValue(time: Date | string): boolean {
    if (time instanceof Date) {
      return !Number.isNaN(time.getTime());
    }

    const normalizedTimeMatch = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
    if (normalizedTimeMatch) {
      return true;
    }

    const parsedTime = new Date(time);
    return !Number.isNaN(parsedTime.getTime());
  }

  private formatPeriodLabel(label: string): string {
    return label.trim().toLocaleLowerCase('pt-BR');
  }
}
