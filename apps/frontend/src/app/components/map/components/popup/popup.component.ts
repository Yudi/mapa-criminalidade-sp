import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import {
  GroupedOccurrence,
  UnifiedOccurrence,
} from '@mapa-criminalidade/shared-types';

@Component({
  selector: 'app-popup',
  templateUrl: './popup.component.html',
  styleUrl: './popup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class PopupComponent {
  readonly groupedOccurrences = input<GroupedOccurrence[]>([]);
  readonly closed = output<void>();
  groupIndex = signal(0);
  occurrenceIndex = signal(0);
  readonly currentGroup = computed(() => {
    const groups = this.groupedOccurrences();
    const idx = this.groupIndex();
    return groups[idx] ?? null;
  });

  readonly currentOccurrence = computed(() => {
    const group = this.currentGroup();
    if (!group) return null;
    const idx = this.occurrenceIndex();
    return group.occurrences[idx] ?? null;
  });

  readonly totalGroups = computed(() => this.groupedOccurrences().length);
  readonly totalOccurrencesInGroup = computed(
    () => this.currentGroup()?.occurrences.length ?? 0
  );
  set index(value: number) {
    this.groupIndex.set(value);
    this.occurrenceIndex.set(0);
  }

  get index(): number {
    return this.groupIndex();
  }
  nextGroup(): void {
    const current = this.groupIndex();
    if (current < this.totalGroups() - 1) {
      this.groupIndex.set(current + 1);
      this.occurrenceIndex.set(0);
    }
  }

  prevGroup(): void {
    const current = this.groupIndex();
    if (current > 0) {
      this.groupIndex.set(current - 1);
      this.occurrenceIndex.set(0);
    }
  }
  nextOccurrence(): void {
    const current = this.occurrenceIndex();
    if (current < this.totalOccurrencesInGroup() - 1) {
      this.occurrenceIndex.set(current + 1);
    }
  }

  prevOccurrence(): void {
    const current = this.occurrenceIndex();
    if (current > 0) {
      this.occurrenceIndex.set(current - 1);
    }
  }

  formatAddress(occurrence: UnifiedOccurrence): string {
    const addressParts = [
      occurrence.logradouro,
      occurrence.numeroLogradouro,
      occurrence.bairro,
      occurrence.cidade,
    ];

    const formattedAddress = addressParts
      .filter((part) => part && String(part).trim() !== '')
      .join(', ');
    return formattedAddress || 'Endereço não disponível';
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

    const brazilianDateMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(date);
    if (brazilianDateMatch) {
      const [, day, month, year] = brazilianDateMatch;
      return `${day.padStart(2, '0')}/${month.padStart(2, '0')}/${year}`;
    }

    const parsedDate = new Date(date);
    return this.formatDateObject(parsedDate, date);
  }

  formatTime(time: string | null | undefined): string {
    if (!time) return '';
    return time;
  }

  private formatDateObject(date: Date, fallback: string): string {
    if (Number.isNaN(date.getTime())) return fallback;

    return date.toLocaleDateString('pt-BR');
  }
}
