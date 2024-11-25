import { Test, TestingModule } from '@nestjs/testing';
import { BoletinsOcorrenciaService } from './boletins-ocorrencia.service';

describe('BoletinsOcorrenciaService', () => {
  let service: BoletinsOcorrenciaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BoletinsOcorrenciaService],
    }).compile();

    service = module.get<BoletinsOcorrenciaService>(BoletinsOcorrenciaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
