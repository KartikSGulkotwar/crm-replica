import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { WorkspaceModelService } from './workspace-model.service';

@Module({
  controllers: [RecordsController, OpenApiController],
  providers: [RecordsService, WorkspaceModelService],
  exports: [RecordsService, WorkspaceModelService],
})
export class RecordsModule {}
