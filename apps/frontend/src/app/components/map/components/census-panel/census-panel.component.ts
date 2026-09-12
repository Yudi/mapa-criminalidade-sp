import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { DecimalPipe, CurrencyPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import {
  CensusAreaDetail,
  CensusCrimeStats,
} from '@mapa-criminalidade/shared-types';

@Component({
  selector: 'app-census-panel',
  imports: [DecimalPipe, CurrencyPipe, MatButtonModule, MatDialogModule],
  templateUrl: './census-panel.component.html',
  styleUrl: './census-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CensusPanelComponent {
  readonly area = input.required<CensusAreaDetail>();
  readonly crimes = input<CensusCrimeStats | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly datesAvailable = input(false);
  readonly applied = input(false);
  readonly applyArea = output<void>();
  readonly dismiss = output<void>();
  readonly retry = output<void>();
  readonly period = computed(() => {
    const stats = this.crimes();
    const date = (value: string) => value.split('-').reverse().join('/');
    return stats ? `${date(stats.after)} a ${date(stats.before)}` : '';
  });
  readonly populationDensity = computed(() => {
    const area = this.area();
    return area.population !== null && area.areaKm2 > 0
      ? area.population / area.areaKm2
      : null;
  });
  readonly groups = computed(() => {
    const groups = new Map<string, CensusAreaDetail['indicators']>();
    for (const indicator of this.area().indicators) {
      if (indicator.key === 'population') continue;
      const items = groups.get(indicator.group) ?? [];
      items.push({
        ...indicator,
        label: INDICATOR_LABELS[indicator.key] ?? indicator.label,
      });
      groups.set(indicator.group, items);
    }
    return [...groups].map(([name, indicators]) => ({ name, indicators }));
  });
}

const INDICATOR_LABELS: Record<string, string> = {
  households: 'Total de domicílios',
  occupiedHouseholds: 'Particulares ocupados',
  vacantHouseholds: 'Permanentes vagos',
  residentsPerHousehold: 'Média de moradores por domicílio ocupado',
  men: 'Masculino',
  women: 'Feminino',
  children: '0 a 14 anos',
  youth: '15 a 29 anos',
  olderAdults: '60 anos ou mais',
  literate: 'Alfabetizadas - 15 anos ou mais',
  permanentHouseholds: 'Permanentes ocupados',
  apartments: 'Apartamentos ocupados',
  waterNetwork: 'Rede geral de água',
  sewageNetwork: 'Rede de esgoto ou pluvial',
  wasteCollection: 'Coleta domiciliar de lixo',
  responsibleIncomeMean: 'Média',
  responsibleIncomeMedian: 'Mediana',
};
