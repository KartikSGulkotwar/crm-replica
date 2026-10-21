import { Module } from '@nestjs/common';
import { RecordsModule } from '../records/records.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [RecordsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
