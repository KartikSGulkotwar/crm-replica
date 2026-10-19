import { defineView } from '@crm-replica/sdk';

/** Deals worth 50k or more, closing soonest first. */
export default defineView({
  name: 'Big deals',
  object: 'deals',
  filters: [{ field: 'amount', op: 'gte', value: 50000 }],
  sorts: [{ field: 'closeDate', direction: 'asc' }],
  fields: [{ name: 'name', width: 260 }, 'amount', 'stage', 'closeDate', 'company'],
});
