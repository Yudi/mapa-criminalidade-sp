import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CensusService } from './census.service';
import { parseIntegerParam } from '../map-features/utils/map-feature-request.utils';

@ApiTags('Census')
@Controller('census')
export class CensusController {
  constructor(private readonly census: CensusService) {}

  @Get(':releaseId/:level/:z/:x/:y.mvt')
  @ApiOperation({
    summary: 'Versioned SP census polygons and label points',
    description:
      'On-demand MVT; areas and labels layers. No indicators or crime totals in tile payloads. Municipality zoom >=6; neighborhood zoom >=11.',
  })
  @ApiParam({ name: 'releaseId', example: 'ibge-2022-sp-20260520-v1' })
  @ApiParam({ name: 'level', enum: ['municipality', 'neighborhood'] })
  @ApiResponse({
    status: 200,
    description:
      'application/vnd.mapbox-vector-tile; immutable census geometry.',
  })
  async tile(
    @Param('releaseId') releaseId: string,
    @Param('level') level: string,
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.on('aborted', onClose);
    res.on('close', onClose);
    try {
      const data = await this.census.tile(
        releaseId,
        level,
        parseIntegerParam(z, 'z'),
        parseIntegerParam(x, 'x'),
        parseIntegerParam(y, 'y'),
        abort.signal
      );
      if (abort.signal.aborted) return;
      res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.status(200).send(data);
    } finally {
      req.off('aborted', onClose);
      res.off('close', onClose);
    }
  }
}
