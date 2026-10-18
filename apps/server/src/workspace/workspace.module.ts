import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/user.entity';
import { MetadataModule } from '../metadata/metadata.module';
import { InvitesController, WorkspaceController } from './workspace.controller';
import { WorkspaceEntity } from './workspace.entity';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity, UserEntity]), MetadataModule],
  controllers: [WorkspaceController, InvitesController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
