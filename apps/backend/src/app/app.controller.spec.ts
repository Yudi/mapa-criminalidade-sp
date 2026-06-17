import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  const prisma = {
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });

    it('returns liveness status', () => {
      expect(appController.getLiveness()).toMatchObject({
        status: 'ok',
      });
    });

    it('returns readiness status after checking the database', async () => {
      await expect(appController.getReadiness()).resolves.toMatchObject({
        status: 'ok',
        checks: {
          database: 'ok',
        },
      });
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
