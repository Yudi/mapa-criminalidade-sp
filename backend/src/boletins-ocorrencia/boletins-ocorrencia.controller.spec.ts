import { Test, TestingModule } from '@nestjs/testing';
import { BoletinsOcorrenciaController } from './boletins-ocorrencia.controller';

describe('BoletinsOcorrenciaController', () => {
  let controller: BoletinsOcorrenciaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BoletinsOcorrenciaController],
    }).compile();

    controller = module.get<BoletinsOcorrenciaController>(BoletinsOcorrenciaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
