import { Module } from '@nestjs/common';
import { MetadataModule } from '../metadata/metadata.module';
import { RecordsModule } from '../records/records.module';
import { ViewsModule } from '../views/views.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

@Module({
  imports: [MetadataModule, ViewsModule, RecordsModule],
  controllers: [AppsController],
  providers: [AppsService],
})
export class AppsModule {}
