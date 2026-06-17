import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PopupComponent } from './popup.component';

describe('PopupComponent', () => {
  let component: PopupComponent;
  let fixture: ComponentFixture<PopupComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PopupComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PopupComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('formats API date-only strings without timezone shifts', () => {
    expect(component.formatDate('2024-01-15')).toBe('15/01/2024');
  });

  it('formats Brazilian source date strings consistently', () => {
    expect(component.formatDate('5/1/2024')).toBe('05/01/2024');
  });
});
