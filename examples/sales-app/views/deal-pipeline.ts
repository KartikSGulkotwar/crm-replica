import { defineView, ViewType } from '@crm-replica/sdk';

/** Deals on a kanban board, one column per stage. */
export default defineView({
  name: 'Deal pipeline',
  object: 'deals',
  type: ViewType.KANBAN,
  kanbanField: 'stage',
  fields: ['name', 'amount', 'company', 'closeDate'],
});
