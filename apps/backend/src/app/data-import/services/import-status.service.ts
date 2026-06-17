import { Injectable, Logger } from '@nestjs/common';

import { ImportStatus } from '../types/data-import.types';

import { DataCategoryConfig } from '../config/data-category.config';

import { DatabaseService } from './database.service';
@Injectable()
export class ImportStatusService {
  private readonly logger = new Logger(ImportStatusService.name);

  constructor(private readonly databaseService: DatabaseService) {}
  async getImportStatus(): Promise<
    Record<string, Record<number, ImportStatus>>
  > {
    this.logger.log('Generating import status report...');
    const status: Record<string, Record<number, ImportStatus>> = {};

    for (const category of DataCategoryConfig.getDataCategories()) {
      if (!category.hasSchema) continue;

      status[category.name] = {};

      for (const year of category.years) {
        const tableName = DataCategoryConfig.getTableName(category, year);
        const exists = await this.databaseService.checkTableExists(tableName);

        if (exists) {
          const recordCount = await this.databaseService.getTableRecordCount(
            tableName
          );
          status[category.name][year] = {
            tableExists: true,
            recordCount: recordCount,
          };
        } else {
          status[category.name][year] = {
            tableExists: false,
            recordCount: 0,
          };
        }
      }
    }

    this.logger.log('Import status report generated successfully');
    return status;
  }
  async getCategoryStatus(
    categoryName: string
  ): Promise<Record<number, ImportStatus> | null> {
    const category = DataCategoryConfig.getDataCategories().find(
      (cat) => cat.name === categoryName
    );

    if (!category || !category.hasSchema) {
      return null;
    }

    const status: Record<number, ImportStatus> = {};

    for (const year of category.years) {
      const tableName = DataCategoryConfig.getTableName(category, year);
      const exists = await this.databaseService.checkTableExists(tableName);

      if (exists) {
        const recordCount = await this.databaseService.getTableRecordCount(
          tableName
        );
        status[year] = {
          tableExists: true,
          recordCount: recordCount,
        };
      } else {
        status[year] = {
          tableExists: false,
          recordCount: 0,
        };
      }
    }

    return status;
  }
  async getImportStatistics(): Promise<{
    totalCategories: number;
    categoriesWithData: number;
    totalTables: number;
    tablesWithData: number;
    totalRecords: number;
  }> {
    const allStatus = await this.getImportStatus();

    let totalCategories = 0;
    let categoriesWithData = 0;
    let totalTables = 0;
    let tablesWithData = 0;
    let totalRecords = 0;

    for (const yearStatuses of Object.values(allStatus)) {
      totalCategories++;
      let categoryHasData = false;

      for (const status of Object.values(yearStatuses)) {
        totalTables++;

        if (status.tableExists && status.recordCount > 0) {
          tablesWithData++;
          totalRecords += status.recordCount;
          categoryHasData = true;
        }
      }

      if (categoryHasData) {
        categoriesWithData++;
      }
    }

    return {
      totalCategories,
      categoriesWithData,
      totalTables,
      tablesWithData,
      totalRecords,
    };
  }
  async hasTableData(tableName: string): Promise<boolean> {
    const exists = await this.databaseService.checkTableExists(tableName);
    if (!exists) return false;

    const recordCount = await this.databaseService.getTableRecordCount(
      tableName
    );
    return recordCount > 0;
  }
  async getTablesNeedingAttention(): Promise<
    Array<{
      category: string;
      year: number;
      tableName: string;
      issue: 'missing' | 'empty';
    }>
  > {
    const tablesNeedingAttention: Array<{
      category: string;
      year: number;
      tableName: string;
      issue: 'missing' | 'empty';
    }> = [];

    for (const category of DataCategoryConfig.getValidCategories()) {
      for (const year of category.years) {
        const tableName = DataCategoryConfig.getTableName(category, year);
        const exists = await this.databaseService.checkTableExists(tableName);

        if (!exists) {
          tablesNeedingAttention.push({
            category: category.name,
            year: year,
            tableName: tableName,
            issue: 'missing',
          });
        } else {
          const recordCount = await this.databaseService.getTableRecordCount(
            tableName
          );
          if (recordCount === 0) {
            tablesNeedingAttention.push({
              category: category.name,
              year: year,
              tableName: tableName,
              issue: 'empty',
            });
          }
        }
      }
    }

    return tablesNeedingAttention;
  }
}
