import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SvgAttributionComponent } from './svg-attribution.component';

describe('SvgAttributionComponent', () => {
  let component: SvgAttributionComponent;
  let fixture: ComponentFixture<SvgAttributionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SvgAttributionComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SvgAttributionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
