import { CreateObjectInput, FieldType } from '@crm-replica/shared';

export interface StandardObjectDefinition {
  input: CreateObjectInput;
  isSystem?: boolean;
  position: number;
}

export const WORKSPACE_MEMBER_TABLE = 'workspace_members';

/**
 * Objects every workspace starts with. They can get extra custom fields but can't be deleted.
 * Listed in creation order: relation targets come before the objects pointing at them.
 */
export const STANDARD_OBJECTS: StandardObjectDefinition[] = [
  {
    // Mirrors the workspace's user accounts so records (e.g. Task.assignee) can point at people
    // on the team. Hidden from the sidebar and read-only; kept in sync by WorkspaceMembersService.
    isSystem: true,
    position: 100,
    input: {
      nameSingular: 'workspaceMember',
      namePlural: 'workspaceMembers',
      labelSingular: 'Workspace member',
      labelPlural: 'Workspace members',
      icon: 'user-circle',
      fields: [
        { name: 'name', label: 'Name', type: FieldType.TEXT },
        { name: 'email', label: 'Email', type: FieldType.EMAIL },
      ],
    },
  },
  {
    position: 0,
    input: {
      nameSingular: 'company',
      namePlural: 'companies',
      labelSingular: 'Company',
      labelPlural: 'Companies',
      icon: 'building',
      description: 'Organizations you sell to or work with',
      fields: [
        { name: 'name', label: 'Name', type: FieldType.TEXT },
        { name: 'domain', label: 'Domain', type: FieldType.LINK },
        { name: 'employees', label: 'Employees', type: FieldType.NUMBER },
        {
          name: 'industry',
          label: 'Industry',
          type: FieldType.SELECT,
          options: [
            { label: 'Software', color: 'blue' },
            { label: 'Finance', color: 'green' },
            { label: 'Healthcare', color: 'red' },
            { label: 'Retail', color: 'orange' },
            { label: 'Manufacturing', color: 'gray' },
            { label: 'Education', color: 'purple' },
            { label: 'Other', color: 'teal' },
          ],
        },
        {
          name: 'annualRevenue',
          label: 'Annual revenue',
          type: FieldType.CURRENCY,
          settings: { currency: 'USD' },
        },
      ],
    },
  },
  {
    position: 1,
    input: {
      nameSingular: 'person',
      namePlural: 'people',
      labelSingular: 'Person',
      labelPlural: 'People',
      icon: 'user',
      description: 'Contacts at your companies',
      labelIdentifierFieldName: 'firstName',
      fields: [
        { name: 'firstName', label: 'First name', type: FieldType.TEXT },
        { name: 'lastName', label: 'Last name', type: FieldType.TEXT },
        { name: 'email', label: 'Email', type: FieldType.EMAIL },
        { name: 'phone', label: 'Phone', type: FieldType.PHONE },
        { name: 'jobTitle', label: 'Job title', type: FieldType.TEXT },
        {
          name: 'company',
          label: 'Company',
          type: FieldType.RELATION,
          relation: { targetObject: 'company', inverseName: 'people', inverseLabel: 'People' },
        },
      ],
    },
  },
  {
    position: 2,
    input: {
      nameSingular: 'opportunity',
      namePlural: 'opportunities',
      labelSingular: 'Opportunity',
      labelPlural: 'Opportunities',
      icon: 'target',
      description: 'Deals in your pipeline',
      fields: [
        { name: 'name', label: 'Name', type: FieldType.TEXT },
        {
          name: 'amount',
          label: 'Amount',
          type: FieldType.CURRENCY,
          settings: { currency: 'USD' },
        },
        {
          name: 'stage',
          label: 'Stage',
          type: FieldType.SELECT,
          options: [
            { label: 'New', color: 'gray' },
            { label: 'Qualified', color: 'blue' },
            { label: 'Proposal', color: 'purple' },
            { label: 'Won', color: 'green' },
            { label: 'Lost', color: 'red' },
          ],
          defaultValue: 'NEW',
        },
        { name: 'closeDate', label: 'Close date', type: FieldType.DATE },
        {
          name: 'company',
          label: 'Company',
          type: FieldType.RELATION,
          relation: {
            targetObject: 'company',
            inverseName: 'opportunities',
            inverseLabel: 'Opportunities',
          },
        },
        {
          name: 'pointOfContact',
          label: 'Point of contact',
          type: FieldType.RELATION,
          relation: {
            targetObject: 'person',
            inverseName: 'opportunities',
            inverseLabel: 'Opportunities',
          },
        },
      ],
    },
  },
  {
    position: 3,
    input: {
      nameSingular: 'note',
      namePlural: 'notes',
      labelSingular: 'Note',
      labelPlural: 'Notes',
      icon: 'note',
      labelIdentifierFieldName: 'title',
      fields: [
        { name: 'title', label: 'Title', type: FieldType.TEXT },
        { name: 'body', label: 'Body', type: FieldType.TEXT },
      ],
    },
  },
  {
    position: 4,
    input: {
      nameSingular: 'task',
      namePlural: 'tasks',
      labelSingular: 'Task',
      labelPlural: 'Tasks',
      icon: 'check',
      labelIdentifierFieldName: 'title',
      fields: [
        { name: 'title', label: 'Title', type: FieldType.TEXT },
        { name: 'body', label: 'Body', type: FieldType.TEXT },
        { name: 'dueDate', label: 'Due date', type: FieldType.DATE_TIME },
        {
          name: 'status',
          label: 'Status',
          type: FieldType.SELECT,
          options: [
            { label: 'To do', color: 'gray' },
            { label: 'In progress', color: 'blue' },
            { label: 'Done', color: 'green' },
          ],
          defaultValue: 'TO_DO',
        },
        {
          name: 'assignee',
          label: 'Assignee',
          type: FieldType.RELATION,
          relation: {
            targetObject: 'workspaceMember',
            inverseName: 'assignedTasks',
            inverseLabel: 'Assigned tasks',
          },
        },
      ],
    },
  },
];
