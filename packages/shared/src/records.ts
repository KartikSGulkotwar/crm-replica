import type { FilterOperator } from './metadata/field-types';

/** A single condition, e.g. `{ field: 'name', op: 'contains', value: 'acme' }`. */
export interface FilterCondition {
  field: string;
  op: FilterOperator;
  value?: unknown;
}

/** JSON filter tree accepted by `GET /api/objects/{plural}?filter=…`. */
export type RecordFilter =
  FilterCondition | { and: RecordFilter[] } | { or: RecordFilter[] } | { not: RecordFilter };

export type SortDirection = 'asc' | 'desc';

export interface RecordSort {
  field: string;
  direction: SortDirection;
}

/** A record as returned by the API: system fields plus one key per field (`<relation>Id` for relations). */
export interface RecordDto {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  position: number;
  [field: string]: unknown;
}

export interface CurrencyValue {
  amount: number | null;
  currency: string | null;
}

export interface PageInfo {
  hasNextPage: boolean;
  /** Pass as `cursor` to get the next page. */
  endCursor: string | null;
}

export interface ListRecordsResponse {
  data: RecordDto[];
  pageInfo: PageInfo;
  totalCount: number;
}

export const RECORDS_DEFAULT_LIMIT = 50;
export const RECORDS_MAX_LIMIT = 200;

/** Turns sorts into the `sort` query parameter: `name:asc,createdAt:desc`. */
export const serializeSort = (sorts: RecordSort[]) =>
  sorts.map((s) => `${s.field}:${s.direction}`).join(',');
