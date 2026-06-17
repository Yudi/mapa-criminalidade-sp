import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { getDatabaseUrl } from './database-url.util';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: getDatabaseUrl(),
        max: PrismaService.getPositiveIntegerEnv('PRISMA_POOL_MAX', 3),
        idleTimeoutMillis: PrismaService.getPositiveIntegerEnv(
          'PRISMA_POOL_IDLE_TIMEOUT_MS',
          10_000
        ),
        connectionTimeoutMillis: PrismaService.getPositiveIntegerEnv(
          'PRISMA_POOL_CONNECTION_TIMEOUT_MS',
          5_000
        ),
      }),
    });
  }

  private static getPositiveIntegerEnv(name: string, fallback: number): number {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
