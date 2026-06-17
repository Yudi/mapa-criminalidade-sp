import {
  Controller,
  Get,
  Post,
  Body,
  Logger,
  HttpException,
  HttpStatus,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DataImportService } from './data-import-orchestrator.service';
import { ImportStatusResponseDto } from './dto/import-response.dto';
import { DevelopmentOnlyGuard } from '../shared/guards/development-only.guard';
import { DataImportQueueService } from './queue/data-import-queue.service';
import { DataImportJobName } from './queue/data-import-queue.types';
import {
  dataImportTriggerBodySchema,
  DataImportTriggerBody,
} from './schemas/data-import-trigger.schema';
import {
  getErrorMessage,
  getErrorNumberProperty,
} from '../shared/error.utils';

@ApiTags('Data Import')
@Controller('data-import')
export class DataImportController {
  private readonly logger = new Logger(DataImportController.name);

  constructor(
    private readonly dataImportService: DataImportService,
    private readonly dataImportQueueService: DataImportQueueService
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get import status',
    description:
      'Returns the current status of data imports, including table existence and record counts for each data category and year.',
  })
  @ApiResponse({
    status: 200,
    description: 'Import status retrieved successfully',
    type: ImportStatusResponseDto,
  })
  async getImportStatus(): Promise<ImportStatusResponseDto> {
    try {
      const status = await this.dataImportService.getImportStatus();
      return {
        status,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get import status:', error);
      throw new HttpException(
        'Failed to get import status',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('trigger')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(DevelopmentOnlyGuard)
  @ApiOperation({
    summary: 'Manually trigger data import',
    description:
      'Enqueues a manual import for a specific data category or all categories. Used for testing parallel processing.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description:
            'Name of the category to import (e.g., "Dados Criminais"). If not provided, imports all categories.',
          example: 'Dados Criminais',
        },
      },
    },
  })
  @ApiResponse({
    status: 202,
    description: 'Import job queued successfully',
  })
  async triggerImport(
    @Body() body: unknown
  ): Promise<{
    message: string;
    jobId?: string;
    jobName: DataImportJobName;
    category?: string;
  }> {
    try {
      const parsedBody = this.parseTriggerBody(body);
      this.logger.log(
        `Manual import triggered${
          parsedBody.category
            ? ` for category: ${parsedBody.category}`
            : ' for all categories'
        }`
      );

      if (parsedBody.category) {
        const categories = this.dataImportService.getDataCategories();
        const category = categories.find(
          (cat) => cat.name === parsedBody.category
        );

        if (!category) {
          throw new HttpException(
            `Category "${
              parsedBody.category
            }" not found. Available categories: ${categories
              .map((c) => c.name)
              .join(', ')}`,
            HttpStatus.BAD_REQUEST
          );
        }

        const job = await this.dataImportQueueService.enqueueManualImport(
          parsedBody.category
        );

        return {
          message: `Import queued for category "${parsedBody.category}".`,
          jobId: job.id,
          jobName: job.name,
          category: parsedBody.category,
        };
      } else {
        const job = await this.dataImportQueueService.enqueueManualImport();

        return {
          message: 'Import queued for all categories.',
          jobId: job.id,
          jobName: job.name,
        };
      }
    } catch (error) {
      this.logger.error('Failed to trigger import:', error);
      throw new HttpException(
        getErrorMessage(error) || 'Failed to trigger import',
        getErrorNumberProperty(error, 'status') ??
          HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private parseTriggerBody(body: unknown): DataImportTriggerBody {
    const result = dataImportTriggerBodySchema.safeParse(body ?? {});

    if (!result.success) {
      throw new HttpException(
        `Invalid import trigger body: ${result.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
        HttpStatus.BAD_REQUEST
      );
    }

    return result.data;
  }
}
