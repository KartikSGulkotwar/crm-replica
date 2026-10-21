import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecordsModule } from '../records/records.module';
import { AgentConversationEntity } from './agent-conversation.entity';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AgentToolExecutor } from './agent-tools';

@Module({
  imports: [TypeOrmModule.forFeature([AgentConversationEntity]), RecordsModule],
  controllers: [AgentController],
  providers: [AgentService, AgentToolExecutor],
})
export class AgentsModule {}
