import type { FilterOperator, OptionColor, RelationOnDelete } from '@crm-replica/shared';
import { FieldType, ViewType } from '@crm-replica/shared';

export { FieldType, ViewType };
export type { FilterOperator, OptionColor, RelationOnDelete };

/** A select option: just a label (`'Won'`), or a label with a stored value and/or color. */
export type OptionDefinition = string | { label: string; value?: string; color?: OptionColor };

interface FieldBase {
  /** camelCase API name. Defaults to the label in camelCase (`Close date` → `closeDate`). */
  name?: string;
  label: string;
  description?: string;
  /** Records can't be saved without a value. */
  isRequired?: boolean;
}

/** One field. The allowed extras depend on `type` (e.g. only selects have `options`). */
export type FieldDefinition =
  | (FieldBase & { type: FieldType.TEXT; defaultValue?: string })
  | (FieldBase & { type: FieldType.NUMBER; defaultValue?: number })
  | (FieldBase & { type: FieldType.BOOLEAN; defaultValue?: boolean })
  | (FieldBase & {
      type: FieldType.CURRENCY;
      settings?: { /** e.g. 'EUR' (default USD) */ currency?: string };
    })
  | (FieldBase & {
      type:
        FieldType.DATE | FieldType.DATE_TIME | FieldType.EMAIL | FieldType.PHONE | FieldType.LINK;
    })
  | (FieldBase & {
      type: FieldType.SELECT;
      options: OptionDefinition[];
      /** an option value */ defaultValue?: string;
    })
  | (FieldBase & {
      type: FieldType.MULTI_SELECT;
      options: OptionDefinition[];
      defaultValue?: string[];
    })
  | (FieldBase & {
      type: FieldType.RATING;
      settings?: { /** 1-10 stars (default 5) */ max?: number };
      defaultValue?: number;
    })
  | (FieldBase & {
      type: FieldType.RELATION;
      relation: {
        /** nameSingular of the object to link to, e.g. 'company'. */
        targetObject: string;
        /** The reverse list on the target, e.g. 'deals' on Company (default: this object's plural). */
        inverseName?: string;
        inverseLabel?: string;
        /** When the linked record is permanently deleted (default SET_NULL). */
        onDelete?: RelationOnDelete;
      };
    });

export interface ObjectDefinition {
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description?: string;
  /** e.g. 'handshake', 'folder', 'ticket' (see the icon picker in Settings). */
  icon?: string;
  /** The field shown as each record's title (default: `name`). */
  labelIdentifierFieldName?: string;
  fields: FieldDefinition[];
}

export interface ViewDefinition {
  name: string;
  /** The object's singular or plural name. */
  object: string;
  type?: ViewType | `${ViewType}`;
  /** KANBAN: the select field whose options become columns. */
  kanbanField?: string;
  /** How filters combine (default 'and'). */
  filterConjunction?: 'and' | 'or';
  /** Visible fields in order (others are hidden). Omit to show all. */
  fields?: (string | { name: string; width?: number })[];
  filters?: { field: string; op: FilterOperator; value?: unknown }[];
  sorts?: { field: string; direction?: 'asc' | 'desc' }[];
}

// Plain (non-generic) parameter types keep TypeScript's excess-property checks, so typos and
// options on the wrong field type are reported while you write.

/**
 * Declares an object (a record type) and its fields. Default-export it from a file in your
 * app's `objects/` folder; `crm push` creates or updates it in your workspace.
 */
export function defineObject(definition: ObjectDefinition): ObjectDefinition {
  return definition;
}

/** Declares a field on its own, e.g. to share it between objects. */
export function defineField(definition: FieldDefinition): FieldDefinition {
  return definition;
}

/** Declares a saved view. Default-export it from a file in your app's `views/` folder. */
export function defineView(definition: ViewDefinition): ViewDefinition {
  return definition;
}
