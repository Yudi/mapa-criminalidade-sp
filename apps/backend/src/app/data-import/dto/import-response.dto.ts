import { ApiProperty } from '@nestjs/swagger';

export class ImportStatusResponseDto {
  @ApiProperty({
    description: 'Import status for each data category and year',
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          tableExists: { type: 'boolean' },
          recordCount: { type: 'number' },
        },
      },
    },
  })
  status!: Record<
    string,
    Record<number, { tableExists: boolean; recordCount: number }>
  >;

  @ApiProperty({
    description: 'Timestamp when the status was retrieved',
    example: '2025-09-15T10:30:00.000Z',
  })
  timestamp!: string;
}

export class ImportStartResponseDto {
  @ApiProperty({
    description: 'Message indicating import has started',
    example: 'Data import started in background',
  })
  message!: string;

  @ApiProperty({
    description: 'Timestamp when the import was started',
    example: '2025-09-15T10:30:00.000Z',
  })
  timestamp!: string;
}
