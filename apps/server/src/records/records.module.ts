import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldMetadataEntity } from '../metadata/field-metadata.entity';
import { ObjectMetadataEntity } from '../metadata/object-metadata.entity';
import { OpenApiController } from './openapi.controller';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { WorkspaceModelService } from './workspace-model.service';

@Module({
  // Declared here (not only in MetadataModule) because the worker uses records without the
  // metadata API, and TypeORM only knows entities registered by an imported module.
  imports: [TypeOrmModule.forFeature([ObjectMetadataEntity, FieldMetadataEntity])],
  controllers: [RecordsController, OpenApiController],
  providers: [RecordsService, WorkspaceModelService],
  exports: [RecordsService, WorkspaceModelService],
})
export class RecordsModule {}
