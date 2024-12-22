import { Module } from '@nestjs/common';
import { BoletinsOcorrenciaController } from './boletins-ocorrencia.controller';
import { BoletimOcorrencia } from 'src/boletim.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoletinsOcorrenciaService } from './boletins-ocorrencia.service';
import { ValidatorsService } from 'src/shared/validators/validators.service';

@Module({
  imports: [TypeOrmModule.forFeature([BoletimOcorrencia])],
  controllers: [BoletinsOcorrenciaController],
  providers: [BoletinsOcorrenciaService, ValidatorsService],
})
export class BoletinsOcorrenciaModule {}
