import { Test, TestingModule } from '@nestjs/testing';
import { ValidatorsService } from './validators.service';

describe('ValidatorsService', () => {
  let service: ValidatorsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidatorsService],
    }).compile();

    service = module.get<ValidatorsService>(ValidatorsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('validates real YYYY-MM-DD dates', () => {
    expect(service.isDateValid('2024-02-29')).toBe(true);
    expect(service.isDateValid('2024-99-99')).toBe(false);
    expect(service.isDateValid('2023-02-29')).toBe(false);
    expect(service.isDateValid('2024/02/29')).toBe(false);
  });

  it('rejects non-finite coordinates and radii', () => {
    expect(service.isCoordinatesValid(-46.63, -23.55)).toBe(true);
    expect(service.isCoordinatesValid(Number.NaN, -23.55)).toBe(false);
    expect(service.isCoordinatesValid(-181, -23.55)).toBe(false);
    expect(service.isRadiusValid(10000)).toBe(true);
    expect(service.isRadiusValid(10001)).toBe(false);
    expect(service.isRadiusValid(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('validates before and after date order', () => {
    expect(service.isBeforeAfterValid('2024-12-31', '2024-01-01')).toBe(true);
    expect(service.isBeforeAfterValid('2024-01-01', '2024-12-31')).toBe(false);
    expect(service.isBeforeAfterValid('2024-99-99', '2024-01-01')).toBe(false);
  });
});
