import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BoletimOcorrencia } from 'src/boletim.entity';
import { BoletinsOcorrenciaModule } from './boletins-ocorrencia/boletins-ocorrencia.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { ValidatorsService } from './shared/validators/validators.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'postgres',
      entities: [BoletimOcorrencia],
      synchronize: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 5,
      },
    ]),
    BoletinsOcorrenciaModule,
  ],
  controllers: [AppController],
  providers: [AppService, ValidatorsService],
})
export class AppModule {
  constructor(private dataSource: DataSource) {}
}
