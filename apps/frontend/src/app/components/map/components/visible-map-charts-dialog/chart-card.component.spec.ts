import { TestBed } from '@angular/core/testing';
import { ChartCardComponent } from './chart-card.component';

describe('selectable chart buckets', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    )
  );
  afterEach(() => vi.unstubAllGlobals());

  it('emits exact filter values through the selection action and ignores unknown data', () => {
    const fixture = TestBed.createComponent(ChartCardComponent);
    fixture.componentRef.setInput('config', {
      title: 'Marcas',
      subtitle: '',
      icon: 'directions_car',
      displayType: 'bar',
      filterKey: 'vehicleBrands',
      buckets: [],
    });
    const emit = vi.spyOn(fixture.componentInstance.bucketSelect, 'emit');
    fixture.componentInstance.selectBucket({
      label: 'Marca exibida',
      filterValue: 'Marca, original',
      count: 2,
    });
    expect(emit).toHaveBeenCalledWith({
      key: 'vehicleBrands',
      value: 'Marca, original',
    });
    fixture.componentInstance.selectBucket({
      label: 'Não informado',
      filterValue: null,
      count: 1,
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('emits numeric ISO weekdays for multi-select controls', () => {
    const fixture = TestBed.createComponent(ChartCardComponent);
    fixture.componentRef.setInput('config', {
      title: 'Dias',
      subtitle: '',
      icon: 'calendar_month',
      displayType: 'bar',
      filterKey: 'weekdays',
      selectedValues: [1, 2],
      buckets: [{ label: 'Segunda', filterValue: '1', count: 3 }],
    });
    const emit = vi.spyOn(fixture.componentInstance.bucketSelect, 'emit');
    fixture.componentInstance.selectBucket({
      label: 'Segunda',
      filterValue: '1',
      count: 3,
    });
    expect(emit).toHaveBeenCalledWith({ key: 'weekdays', value: 1 });
  });
});
