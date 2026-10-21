import type Anthropic from '@anthropic-ai/sdk';
import type { ProposedAction, TranscriptItem } from '@crm-replica/shared';
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** A turn paused for approval: results of the read tools plus the proposed writes. */
export interface PendingTurn {
  proposalId: string;
  /** Every tool_use of the paused assistant turn, in order (all must get a tool_result). */
  toolUseIds: string[];
  readResults: Anthropic.Beta.BetaToolResultBlockParam[];
  writes: { toolUseId: string; name: string; input: unknown }[];
  actions: ProposedAction[];
}

@Entity({ schema: 'core', name: 'agent_conversation' })
export class AgentConversationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'workspace_id' })
  workspaceId: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('text')
  title: string;

  @Column('jsonb')
  messages: Anthropic.Beta.BetaMessageParam[];

  @Column('jsonb')
  transcript: TranscriptItem[];

  @Column('jsonb', { nullable: true })
  pending: PendingTurn | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
