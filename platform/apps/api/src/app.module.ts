import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import { ProblemFilter } from './common/problem.filter';
import { DatabaseModule } from './db/database';
import { HealthController } from './health/health.controller';
import { IngestModule } from './ingest/ingest.module';

@Module({
  imports: [CommonModule, DatabaseModule, IngestModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
