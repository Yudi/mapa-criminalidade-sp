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

  findFirstFive(): Promise<BoletimOcorrencia[]> {
    // get with id 1

    return this.boletinsRepository.find({
      where: { id: 3 },
    });
  }

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
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      beforeDate = beforeDate.split('/').reverse().join('-');
      query += ` AND data_registro <= ${beforeDate}`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      afterDate = afterDate.split('/').reverse().join('-');
      query += ` AND data_registro >= ${afterDate}`;
    }

    return this.boletinsRepository.query(query, [
      centerLongitude,
      centerLatitude,
      radius,
    ]);
  }

  async getBoletinsByRubricaInRange(
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
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      beforeDate = beforeDate.split('/').reverse().join('-');
      query += ` AND data_registro <= ${beforeDate}`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      afterDate = afterDate.split('/').reverse().join('-');
      query += ` AND data_registro >= ${afterDate}`;
    }

    return this.boletinsRepository.query(query, [
      rubrica,
      centerLongitude,
      centerLatitude,
      radius,
    ]);
  }

  async listRubricasInRange(
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

      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      beforeDate = beforeDate.split('/').reverse().join('-');
      query += ` AND data_registro <= ${beforeDate}`;
    }

    if (afterDate && afterDate !== '') {
      if (!this.validatorsService.isDateValid(afterDate)) {
        throw new Error('Invalid after date');
      }
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      afterDate = afterDate.split('/').reverse().join('-');
      query += ` AND data_registro >= ${afterDate}`;
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
}
