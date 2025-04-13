import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BoletimOcorrencia } from 'src/boletim.entity';
import { ValidatorsService } from 'src/shared/validators/validators.service';
import { Repository } from 'typeorm';

@Injectable()
export class BoletinsOcorrenciaService {
  constructor(
    @InjectRepository(BoletimOcorrencia)
    private boletinsRepository: Repository<BoletimOcorrencia>,
    private validatorsService: ValidatorsService,
  ) {}

  async findInRange(
    centerLongitude: number,
    centerLatitude: number,
    radius: number,
    beforeDate: string,
    afterDate: string,
  ) {
    // Range is in meters
    // Using postgis, query the location column
    // First 5 results only
    //dates can be optional

    let query = `
      SELECT * FROM boletins_ocorrencia
      WHERE ST_DWithin(
        location,
        ST_MakePoint($1, $2)::geography,
        $3
      )
    `;
    if (beforeDate && beforeDate !== '') {
      if (!this.validatorsService.isDateValid(beforeDate)) {
        throw new Error('Invalid before date');
      }
      query += ` AND data_registro <= '${beforeDate}'`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      query += ` AND data_registro >= '${afterDate}'`;
    }

    if (!this.validatorsService.isBeforeAfterValid(beforeDate, afterDate)) {
      throw new Error('Invalid before and after date');
    }

    return this.boletinsRepository.query(query, [
      centerLongitude,
      centerLatitude,
      radius,
    ]);
  }

  async getBoletinsByRubricaForPoint(
    centerLongitude: number,
    centerLatitude: number,
    radius: number,
    beforeDate: string,
    afterDate: string,
    rubrica: string,
  ) {
    let query = `
      SELECT * FROM boletins_ocorrencia
      WHERE rubrica = $1
      AND ST_DWithin(
        location,
        ST_MakePoint($2, $3)::geography,
        $4
      )
    `;

    if (beforeDate && beforeDate !== '') {
      if (!this.validatorsService.isDateValid(beforeDate)) {
        throw new Error('Invalid before date');
      }
      query += ` AND data_registro <= '${beforeDate}'`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      query += ` AND data_registro >= '${afterDate}'`;
    }

    if (!this.validatorsService.isBeforeAfterValid(beforeDate, afterDate)) {
      throw new Error('Invalid before and after date');
    }

    const result = (await this.boletinsRepository.query(query, [
      rubrica,
      centerLongitude,
      centerLatitude,
      radius,
    ])) as BoletimOcorrencia[];

    const parseResult = result.map((boletim) => {
      return {
        latitude: boletim.latitude,
        longitude: boletim.longitude,
        rubrica: boletim.rubrica,
        id: boletim.id,
      };
    });
    return parseResult;
  }

  async listRubricasForPointInRange(
    centerLongitude: number,
    centerLatitude: number,
    radius: number,
    beforeDate: string,
    afterDate: string,
  ) {
    let query = `
      SELECT rubrica, COUNT(*) AS count
      FROM boletins_ocorrencia
      WHERE ST_DWithin(
        location,
        ST_MakePoint($1, $2)::geography,
        $3
      )
    `;

    if (beforeDate && beforeDate !== '') {
      if (!this.validatorsService.isDateValid(beforeDate)) {
        throw new Error('Invalid before date');
      }

      query += ` AND data_registro <= '${beforeDate}'`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      query += ` AND data_registro >= '${afterDate}'`;
    }

    if (!this.validatorsService.isBeforeAfterValid(beforeDate, afterDate)) {
      throw new Error('Invalid before and after date');
    }

    query += ` GROUP BY rubrica`;

    const result = await this.boletinsRepository.query(query, [
      centerLongitude,
      centerLatitude,
      radius,
    ]);

    const formattedResult = result
      .map((row) => {
        return { name: row.rubrica, count: parseInt(row.count) };
      })
      .sort((a, b) => b.count - a.count);

    return formattedResult;
  }

  async getFirstDate() {
    const result = await this.boletinsRepository.query(
      'SELECT MIN(data_registro) AS min_date FROM boletins_ocorrencia',
    );
    return result[0].min_date as string;
  }

  async getLastDate() {
    const result = await this.boletinsRepository.query(
      'SELECT MAX(data_registro) AS last_date FROM boletins_ocorrencia',
    );
    return result[0].last_date as string;
  }
}
