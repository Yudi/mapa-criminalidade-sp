import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Req,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MapFeaturesQueryService } from '../services/map-features-query.service';
import { ValidatorsService } from '../../shared/validators/validators.service';
import {
  MAX_CRIME_TILE_ZOOM,
  MIN_CRIME_TILE_ZOOM,
} from '@mapa-criminalidade/shared-types';
import {
  parseIntegerParam,
  parseOptionalHourQuery,
  parseStringListQuery,
  validateDateFilters,
  validateHourFilters,
} from '../utils/map-feature-request.utils';
import {
  TILE_STATUS_HEADER,
  TILE_URL_TEMPLATE,
} from './map-features-controller.constants';

function isBelowTileDataZoom(zoom: number): boolean {
  return zoom < MIN_CRIME_TILE_ZOOM;
}

@ApiTags('Tiles')
@Controller('tiles')
export class TilesController {
  constructor(
    private readonly queryService: MapFeaturesQueryService,
    private readonly validatorsService: ValidatorsService
  ) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Get tile metadata' })
  async getMetadata() {
    const [categories, periods, dateRange] = await Promise.all([
      this.queryService.getCategories(),
      this.queryService.getPeriods(),
      this.queryService.getDateRange(),
    ]);
    const categoryNames = categories.map((c) => c.name);

    return {
      format: 'mvt',
      minZoom: MIN_CRIME_TILE_ZOOM,
      maxZoom: MAX_CRIME_TILE_ZOOM,
      layers: ['occurrences'],
      availableCategories: categoryNames,
      availableRubricas: categoryNames, // Backwards compat
      availablePeriods: periods.map((period) => period.name),
      categoryStats: categories,
      periodStats: periods,
      dateRange,
      tileUrlTemplate: TILE_URL_TEMPLATE,
    };
  }

  @SkipThrottle()
  @Get(':z/:x/:y.mvt')
  @ApiOperation({ summary: 'Get MVT tile' })
  async getTile(
    @Param('z') z: string,
    @Param('x') x: string,
    @Param('y') y: string,
    @Query('before') before: string,
    @Query('after') after: string,
    @Query('categories') categories: string,
    @Query('rubricas') rubricas: string, // Backwards compat
    @Query('periods') periods: string,
    @Query('startHour') startHour: string,
    @Query('endHour') endHour: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    if (req.socket?.destroyed) {
      return;
    }

    const parsedZ = parseIntegerParam(z, 'z');
    const parsedX = parseIntegerParam(x, 'x');
    const parsedY = parseIntegerParam(y, 'y');

    if (parsedZ < 0 || parsedZ > MAX_CRIME_TILE_ZOOM) {
      throw new HttpException(
        `Zoom level must be between 0 and ${MAX_CRIME_TILE_ZOOM}`,
        HttpStatus.BAD_REQUEST
      );
    }

    const maxTile = Math.pow(2, parsedZ);
    if (
      parsedX < 0 ||
      parsedX >= maxTile ||
      parsedY < 0 ||
      parsedY >= maxTile
    ) {
      throw new HttpException(
        'Tile coordinates out of range',
        HttpStatus.BAD_REQUEST
      );
    }

    validateDateFilters(this.validatorsService, before, after);
    const parsedStartHour = parseOptionalHourQuery(startHour, 'startHour');
    const parsedEndHour = parseOptionalHourQuery(endHour, 'endHour');
    validateHourFilters(parsedStartHour, parsedEndHour);

    if (isBelowTileDataZoom(parsedZ)) {
      return res.status(HttpStatus.NO_CONTENT).send();
    }

    // Support both 'categories' and 'rubricas' for backwards compatibility
    const categoryFilter = categories || rubricas;
    const categoryList = parseStringListQuery(categoryFilter);
    const periodList = parseStringListQuery(periods);

    let clientDisconnected = false;
    const onClose = () => {
      clientDisconnected = true;
    };
    req.on('close', onClose);

    try {
      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }

      const tile = await this.queryService.getTile({
        z: parsedZ,
        x: parsedX,
        y: parsedY,
        beforeDate: before,
        afterDate: after,
        categories: categoryList,
        periods: periodList,
        startHour: parsedStartHour,
        endHour: parsedEndHour,
      });

      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }

      res.set({
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': TILE_STATUS_HEADER,
      });

      if (tile.status === 'timeout') {
        res.set({
          [TILE_STATUS_HEADER]: 'timeout',
          'Cache-Control': 'no-store',
        });
        return res.status(HttpStatus.NO_CONTENT).send();
      }

      if (!tile.tile || tile.tile.length === 0) {
        return res.status(HttpStatus.NO_CONTENT).send();
      }

      return res.send(tile.tile);
    } catch {
      if (clientDisconnected || req.socket?.destroyed) {
        return;
      }
      throw new HttpException(
        'Error generating tile',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    } finally {
      req.off('close', onClose);
    }
  }
}
