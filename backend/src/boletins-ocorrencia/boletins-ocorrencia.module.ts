import { Module } from '@nestjs/common';
import { BoletinsOcorrenciaController } from './boletins-ocorrencia.controller';
import { BoletimOcorrencia } from 'src/boletim.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoletinsOcorrenciaService } from './boletins-ocorrencia.service';

@Module({
  imports: [TypeOrmModule.forFeature([BoletimOcorrencia])],
  controllers: [BoletinsOcorrenciaController],
  providers: [BoletinsOcorrenciaService],
})
export class BoletinsOcorrenciaModule {}
