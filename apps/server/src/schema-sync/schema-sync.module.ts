import { Module } from '@nestjs/common';
import { SchemaSyncService } from './schema-sync.service';

@Module({ providers: [SchemaSyncService], exports: [SchemaSyncService] })
export class SchemaSyncModule {}
