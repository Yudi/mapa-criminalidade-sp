import { HttpException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BoletimOcorrencia } from 'src/boletim.entity';
import { Repository } from 'typeorm';

@Injectable()
export class BoletinsOcorrenciaService {
  constructor(
    @InjectRepository(BoletimOcorrencia)
    private boletinsRepository: Repository<BoletimOcorrencia>,
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
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      beforeDate = beforeDate.split('/').reverse().join('-');
      query += ` AND data_registro <= ${beforeDate}`;
    }

    if (afterDate && afterDate !== '') {
      // Date is in DD/MM/YYYY format, convert to YYYY-MM-DD
      afterDate = afterDate.split('/').reverse().join('-');
      query += ` AND data_registro >= ${afterDate}`;
    }

    // query += ` LIMIT 10`;

    return this.boletinsRepository.query(query, [
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
    // Start building the query
    let query = `
      SELECT rubrica, COUNT(*) AS count
      FROM boletins_ocorrencia
      WHERE ST_DWithin(
        location,
        ST_MakePoint($1, $2)::geography,
        $3
      )
    `;

    // Add date filters if they are valid
    if (validateDate(beforeDate) && beforeDate !== '') {
      // Convert beforeDate from DD/MM/YYYY to YYYY-MM-DD
      beforeDate = beforeDate.split('/').reverse().join('-');
      query += ` AND data_registro <= '${beforeDate}'`;
    }

    if (validateDate(afterDate) && afterDate !== '') {
      // Convert afterDate from DD/MM/YYYY to YYYY-MM-DD
      afterDate = afterDate.split('/').reverse().join('-');
      query += ` AND data_registro >= '${afterDate}'`;
    }

    // Group by rubrica and order by rubrica (or any other criteria)
    query += ` GROUP BY rubrica`;

    // Execute the query
    const results = await this.boletinsRepository.query(query, [
      centerLongitude,
      centerLatitude,
      radius,
    ]);

    // Format the results to match the requested structure
    const formattedResults: RubricaCount[] = results.map((result: any) => ({
      rubrica: result.rubrica,
      count: result.count || 0, // Ensure count is 0 if no records are found
    }));

    return formattedResults;
  }
}

function validateDate(date: string): boolean {
  if (!date) {
    throw new HttpException('Missing required query parameters', 400);
  }

  // Date is in DD/MM/YYYY format
  const [day, month, year] = date.split('/').map((part) => parseInt(part));
  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    throw new HttpException('Invalid date format', 400);
  }

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900) {
    throw new HttpException('Invalid date', 400);
  }

  return true;
}

interface RubricaCount {
  rubrica: string;
  count: number;
}
