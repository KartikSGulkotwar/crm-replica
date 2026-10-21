import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldMetadataEntity } from '../metadata/field-metadata.entity';
import { ObjectMetadataEntity } from '../metadata/object-metadata.entity';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { OpenApiController } from './openapi.controller';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { WorkspaceModelService } from './workspace-model.service';

@Module({
  // Declared here (not only in MetadataModule) because the worker uses records without the
  // metadata API, and TypeORM only knows entities registered by an imported module.
  imports: [TypeOrmModule.forFeature([ObjectMetadataEntity, FieldMetadataEntity])],
  controllers: [RecordsController, ActivitiesController, OpenApiController],
  providers: [RecordsService, ActivitiesService, WorkspaceModelService],
  exports: [RecordsService, ActivitiesService, WorkspaceModelService],
})
export class RecordsModule {}
