import { Module } from '@nestjs/common';
import { RecordsModule } from '../records/records.module';
import { TimelineController } from './timeline.controller';
import { TimelineService } from './timeline.service';

/** Writes the timeline from record events. Imported by the API and the worker. */
@Module({
  imports: [RecordsModule],
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineCoreModule {}

/** API side: the timeline endpoints. */
@Module({
  imports: [TimelineCoreModule],
  controllers: [TimelineController],
})
export class TimelineModule {}
