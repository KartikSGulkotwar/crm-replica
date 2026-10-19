import { defineObject, FieldType } from '@crm-replica/sdk';

/** A custom Deal object (the example from TWENTY_SPEC.md, plus a link to Company). */
export default defineObject({
  nameSingular: 'deal',
  namePlural: 'deals',
  labelSingular: 'Deal',
  labelPlural: 'Deals',
  icon: 'handshake',
  description: 'Deals managed as code by the sales-app example',
  fields: [
    { name: 'name', label: 'Name', type: FieldType.TEXT },
    { name: 'amount', label: 'Amount', type: FieldType.CURRENCY },
    {
      name: 'stage',
      label: 'Stage',
      type: FieldType.SELECT,
      options: [
        { label: 'Lead', color: 'gray' },
        { label: 'Negotiation', color: 'orange' },
        { label: 'Won', color: 'green' },
        { label: 'Lost', color: 'red' },
      ],
      defaultValue: 'LEAD',
    },
    { name: 'closeDate', label: 'Close Date', type: FieldType.DATE_TIME },
    {
      name: 'company',
      label: 'Company',
      type: FieldType.RELATION,
      relation: { targetObject: 'company', inverseName: 'deals', inverseLabel: 'Deals' },
    },
  ],
});
