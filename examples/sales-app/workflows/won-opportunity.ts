import { defineWorkflow, StepType, TriggerType } from '@crm-replica/sdk';

/**
 * When an opportunity moves to Won: create a kickoff task and email the team
 * (the example from TWENTY_SPEC.md's definition of done).
 */
export default defineWorkflow({
  name: 'Opportunity won: kickoff',
  description: 'Creates a kickoff task and emails the team when an opportunity is won',
  trigger: {
    type: TriggerType.RECORD_UPDATED,
    object: 'opportunity',
    fields: ['stage'],
    when: { conditions: [{ left: '{{trigger.record.stage}}', op: 'eq', right: 'WON' }] },
  },
  steps: [
    {
      id: 'create_task',
      name: 'Create kickoff task',
      type: StepType.CREATE_RECORD,
      object: 'task',
      values: {
        title: 'Kick off {{trigger.record.name}}',
        body: 'Won on {{trigger.occurredAt}}. Plan the onboarding with the customer.',
        status: 'TO_DO',
      },
    },
    {
      id: 'email_team',
      name: 'Email the team',
      type: StepType.SEND_EMAIL,
      to: 'sales-team@example.com',
      subject: 'Won: {{trigger.record.name}}',
      body: 'We won {{trigger.record.name}} ({{trigger.record.amount.amount}} {{trigger.record.amount.currency}}).\nKickoff task: {{steps.create_task.result.id}}',
    },
  ],
});
