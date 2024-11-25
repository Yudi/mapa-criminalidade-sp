import { Controller, Get, HttpException, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { BoletinsOcorrenciaService } from 'src/boletins-ocorrencia/boletins-ocorrencia.service';

@Controller('boletins-ocorrencia')
export class BoletinsOcorrenciaController {
  constructor(
    private readonly boletinsOcorrenciaService: BoletinsOcorrenciaService,
  ) {}

  @Get('/query-rubricas-for-location')
  @ApiQuery({
    name: 'lon',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'lat',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'radius',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'before',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'after',
    required: true,
    type: String,
  })
  queryRubricasForLocation(
    @Query('lon') lon: string,
    @Query('lat') lat: string,
    @Query('radius') radius: string,
    @Query('before') before: string,
    @Query('after') after: string,
  ) {
    const parsedLon = parseFloat(lon);
    const parsedLat = parseFloat(lat);
    const parsedRadius = parseInt(radius);

    if (!parsedLon || !parsedLat || !parsedRadius) {
      throw new HttpException('Missing required query parameters', 400);
    }
    return this.boletinsOcorrenciaService.findInRange(
      parsedLon,
      parsedLat,
      parsedRadius,
      before,
      after,
    );
  }

  @Get('/query-point')
  @ApiQuery({
    name: 'lon',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'lat',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'radius',
    required: true,
    type: Number,
  })
  @ApiQuery({
    name: 'before',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'after',
    required: true,
    type: String,
  })
  queryLocation(
    @Query('lon') lon: string,
    @Query('lat') lat: string,
    @Query('radius') radius: string,
    @Query('before') before: string,
    @Query('after') after: string,
  ) {
    const parsedLon = parseFloat(lon);
    const parsedLat = parseFloat(lat);
    const parsedRadius = parseInt(radius);

    if (!parsedLon || !parsedLat || !parsedRadius) {
      throw new HttpException('Missing required query parameters', 400);
    }
    return this.boletinsOcorrenciaService.findInRange(
      parsedLon,
      parsedLat,
      parsedRadius,
      before,
      after,
    );
  }
}
