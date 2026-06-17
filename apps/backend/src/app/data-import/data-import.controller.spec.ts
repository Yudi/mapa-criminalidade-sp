import { HttpException, HttpStatus } from '@nestjs/common';
import { DataImportController } from './data-import.controller';
import { DataImportService } from './data-import-orchestrator.service';
import { DataImportQueueService } from './queue/data-import-queue.service';

describe('DataImportController', () => {
  function createController(): {
    controller: DataImportController;
    queueService: Pick<DataImportQueueService, 'enqueueManualImport'>;
  } {
    const dataImportService = {
      getDataCategories: jest.fn().mockReturnValue([
        {
          name: 'Dados Criminais',
        },
      ]),
      getImportStatus: jest.fn(),
    } as unknown as DataImportService;
    const queueService = {
      enqueueManualImport: jest
        .fn()
        .mockResolvedValue({ id: 'job-1', name: 'import-category' }),
    } as unknown as Pick<DataImportQueueService, 'enqueueManualImport'>;

    return {
      controller: new DataImportController(
        dataImportService,
        queueService as DataImportQueueService
      ),
      queueService,
    };
  }

  it('rejects invalid trigger body shapes before queueing', async () => {
    const { controller, queueService } = createController();

    try {
      await controller.triggerImport({ category: '' });
      throw new Error('Expected triggerImport to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.BAD_REQUEST
      );
    }
    expect(queueService.enqueueManualImport).not.toHaveBeenCalled();
  });

  it('trims and queues valid category import requests', async () => {
    const { controller, queueService } = createController();

    await expect(
      controller.triggerImport({ category: ' Dados Criminais ' })
    ).resolves.toMatchObject({
      category: 'Dados Criminais',
      jobId: 'job-1',
    });
    expect(queueService.enqueueManualImport).toHaveBeenCalledWith(
      'Dados Criminais'
    );
  });
});
