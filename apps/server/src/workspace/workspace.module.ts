import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../auth/user.entity';
import { InvitesController, WorkspaceController } from './workspace.controller';
import { WorkspaceEntity } from './workspace.entity';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceEntity, UserEntity])],
  controllers: [WorkspaceController, InvitesController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
