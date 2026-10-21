import { z } from 'zod';

/** A record the assistant used or changed, for links in the chat. */
export interface AgentRecordRef {
  object: string;
  objectLabel: string;
  id: string;
  title: string;
  /** In-app path, e.g. `/objects/companies/<id>`. */
  url: string;
}

export interface ProposedChange {
  field: string;
  label: string;
  before?: unknown;
  after: unknown;
  /** Readable versions where the raw value isn't (a select option's label, a linked record's title). */
  beforeText?: string;
  afterText?: string;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'failed';

/** One write the assistant wants to make. Nothing changes until the user approves it. */
export interface ProposedAction {
  toolUseId: string;
  kind: 'create' | 'update';
  object: string;
  objectLabel: string;
  /** update: the record being changed. */
  record?: AgentRecordRef;
  changes: ProposedChange[];
  status: ProposalStatus;
  /** After approval: the created/updated record, or why it failed. */
  result?: AgentRecordRef;
  error?: string;
}

export type TranscriptItem =
  | { type: 'user'; text: string; at: string }
  | { type: 'assistant'; text: string; records: AgentRecordRef[]; at: string }
  | { type: 'activity'; text: string; at: string }
  | { type: 'proposal'; id: string; actions: ProposedAction[]; at: string }
  | { type: 'error'; text: string; at: string };

export interface AgentConversationDto {
  id: string;
  title: string;
  transcript: TranscriptItem[];
  /** True while proposed changes wait for Approve / Reject. */
  awaitingApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Server-Sent Events from POST …/messages and …/decisions. */
export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'activity'; text: string }
  | { type: 'records'; records: AgentRecordRef[] }
  | { type: 'proposal'; id: string; actions: ProposedAction[] }
  | { type: 'error'; message: string }
  | { type: 'done'; conversation: AgentConversationDto };

export interface AgentStatusDto {
  configured: boolean;
  model: string | null;
}

export const agentMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Type a question')
    .max(4000, 'Keep questions under 4,000 characters'),
});
export type AgentMessageInput = z.infer<typeof agentMessageSchema>;

export const agentDecisionsSchema = z.object({
  decisions: z
    .array(z.object({ toolUseId: z.string().min(1).max(200), approve: z.boolean() }))
    .min(1)
    .max(50),
});
export type AgentDecisionsInput = z.infer<typeof agentDecisionsSchema>;
