import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchemaSyncModule } from '../schema-sync/schema-sync.module';
import { FieldMetadataEntity } from './field-metadata.entity';
import { MetadataController } from './metadata.controller';
import { MetadataService } from './metadata.service';
import { ObjectMetadataEntity } from './object-metadata.entity';
import { StandardObjectsService } from './standard-objects.service';
import { WorkspaceMembersService } from './workspace-members.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ObjectMetadataEntity, FieldMetadataEntity]),
    SchemaSyncModule,
  ],
  controllers: [MetadataController],
  providers: [MetadataService, StandardObjectsService, WorkspaceMembersService],
  exports: [MetadataService, StandardObjectsService, WorkspaceMembersService],
})
export class MetadataModule {}
