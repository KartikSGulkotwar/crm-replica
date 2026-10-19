import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordsModule } from '../records/records.module';
import { ViewEntity, ViewFieldEntity, ViewFilterEntity, ViewSortEntity } from './view.entities';
import { ViewsController } from './views.controller';
import { ViewsService } from './views.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ViewEntity, ViewFieldEntity, ViewFilterEntity, ViewSortEntity]),
    RecordsModule,
  ],
  controllers: [ViewsController],
  providers: [ViewsService],
})
export class ViewsModule {}
