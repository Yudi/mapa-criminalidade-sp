import { MatDialog } from '@angular/material/dialog';
import { registerLocaleData } from '@angular/common';
import pt from '@angular/common/locales/pt';
import { TestBed } from '@angular/core/testing';
import { Subject, of, firstValueFrom } from 'rxjs';
import { CensusCrimeStats } from '@mapa-criminalidade/shared-types';
import { CensusExplorerComponent } from './census-explorer.component';
import { CensusService } from '../../../../shared/census.service';
import { censusStoryArea } from './census.fixtures';

describe('Census explorer request lifecycle', () => {
  beforeAll(() => registerLocaleData(pt));
  it('cancels stale crime queries and clears old counts when filters or area change', () => {
    const oldStats = new Subject<CensusCrimeStats>();
    const newStats = new Subject<CensusCrimeStats>();
    const crimes = vi
      .fn()
      .mockReturnValueOnce(oldStats)
      .mockReturnValueOnce(newStats);
    TestBed.configureTestingModule({
      providers: [{ provide: CensusService, useValue: { crimes } }],
    });
    const fixture = TestBed.createComponent(CensusExplorerComponent);
    fixture.componentRef.setInput('filter', {
      afterDate: '2022-01-01',
      beforeDate: '2022-12-31',
      categories: ['Furto'],
    });
    fixture.componentInstance.area.set(censusStoryArea);
    fixture.detectChanges();
    expect(oldStats.observed).toBe(true);
    fixture.componentRef.setInput('filter', {
      afterDate: '2023-01-01',
      beforeDate: '2023-12-31',
      categories: ['Furto'],
    });
    fixture.detectChanges();
    expect(oldStats.observed).toBe(false);
    expect(fixture.componentInstance.crimes()).toBeNull();
    newStats.next({
      occurrences: 10,
      per100k: 50,
      after: '2023-01-01',
      before: '2023-12-31',
    });
    expect(fixture.componentInstance.crimes()?.occurrences).toBe(10);
    fixture.componentInstance.dismiss();
    fixture.detectChanges();
    expect(newStats.observed).toBe(false);
    expect(fixture.componentInstance.crimes()).toBeNull();
  });
  it('does not fetch census data while the layer controls are closed', () => {
    const release = vi.fn(() => of(null));
    TestBed.configureTestingModule({
      providers: [{ provide: CensusService, useValue: { release } }],
    });
    const fixture = TestBed.createComponent(CensusExplorerComponent);
    fixture.detectChanges();
    expect(release).not.toHaveBeenCalled();
    fixture.componentInstance.toggle();
    expect(release).toHaveBeenCalledTimes(1);
  });
  it('opens a Material dialog, applies the area and cancels requests on close', async () => {
    const pendingStats = new Subject<CensusCrimeStats>();
    const census = {
      detail: vi.fn(() => of(censusStoryArea)),
      crimes: vi.fn(() => pendingStats),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: CensusService, useValue: census }],
    });
    const fixture = TestBed.createComponent(CensusExplorerComponent);
    fixture.componentRef.setInput('filter', {
      afterDate: '2022-01-01',
      beforeDate: '2022-12-31',
      categories: ['Furto'],
    });
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const applied = vi.fn();
    component.applyArea.subscribe(applied);
    component.select({
      releaseId: censusStoryArea.releaseId,
      level: censusStoryArea.level,
      code: censusStoryArea.code,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
    expect(document.querySelector('[role="dialog"] a')).toBeNull();
    expect(pendingStats.observed).toBe(true);
    const closed = firstValueFrom(
      TestBed.inject(MatDialog).openDialogs[0].afterClosed()
    );
    component.applySelectedArea();
    await closed;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(applied).toHaveBeenCalledWith(censusStoryArea);
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
    expect(pendingStats.observed).toBe(false);
    expect(component.area()).toBeNull();
  });
});
