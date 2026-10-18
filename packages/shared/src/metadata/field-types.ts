import { FieldType } from '../field-type';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'containsAny'
  | 'containsAll'
  | 'isEmpty'
  | 'isNotEmpty';

const TEXT_OPS: FilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'notContains',
  'startsWith',
  'isEmpty',
  'isNotEmpty',
];
const NUMBER_OPS: FilterOperator[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'isEmpty',
  'isNotEmpty',
];

export interface FieldTypeInfo {
  label: string;
  description: string;
  /** Operators the records API accepts in filters for this type (Phase 4). */
  operators: FilterOperator[];
  /** Whether `defaultValue` may be set. */
  supportsDefault: boolean;
}

/** One place describing every field type; the server, web app and SDK all read from this. */
export const FIELD_TYPE_INFO: Record<FieldType, FieldTypeInfo> = {
  [FieldType.TEXT]: {
    label: 'Text',
    description: 'Short or long text',
    operators: TEXT_OPS,
    supportsDefault: true,
  },
  [FieldType.NUMBER]: {
    label: 'Number',
    description: 'A number',
    operators: NUMBER_OPS,
    supportsDefault: true,
  },
  [FieldType.CURRENCY]: {
    label: 'Currency',
    description: 'An amount with a currency code',
    operators: NUMBER_OPS,
    supportsDefault: false,
  },
  [FieldType.BOOLEAN]: {
    label: 'Checkbox',
    description: 'Yes or no',
    operators: ['eq'],
    supportsDefault: true,
  },
  [FieldType.DATE]: {
    label: 'Date',
    description: 'A calendar date',
    operators: NUMBER_OPS,
    supportsDefault: false,
  },
  [FieldType.DATE_TIME]: {
    label: 'Date & time',
    description: 'A moment in time',
    operators: NUMBER_OPS,
    supportsDefault: false,
  },
  [FieldType.SELECT]: {
    label: 'Select',
    description: 'One option from a list',
    operators: ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
    supportsDefault: true,
  },
  [FieldType.MULTI_SELECT]: {
    label: 'Multi-select',
    description: 'Any number of options from a list',
    operators: ['containsAny', 'containsAll', 'isEmpty', 'isNotEmpty'],
    supportsDefault: true,
  },
  [FieldType.EMAIL]: {
    label: 'Email',
    description: 'An email address',
    operators: TEXT_OPS,
    supportsDefault: false,
  },
  [FieldType.PHONE]: {
    label: 'Phone',
    description: 'A phone number',
    operators: TEXT_OPS,
    supportsDefault: false,
  },
  [FieldType.LINK]: {
    label: 'Link',
    description: 'A web address',
    operators: TEXT_OPS,
    supportsDefault: false,
  },
  [FieldType.RATING]: {
    label: 'Rating',
    description: 'A score from 1 to N stars',
    operators: NUMBER_OPS,
    supportsDefault: true,
  },
  [FieldType.RELATION]: {
    label: 'Relation',
    description: 'Links to a record of another object',
    operators: ['eq', 'neq', 'in', 'notIn', 'isEmpty', 'isNotEmpty'],
    supportsDefault: false,
  },
};

export const OPTION_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

export type RelationOnDelete = 'SET_NULL' | 'CASCADE' | 'RESTRICT';
