import type { CurrencyValue, FieldMetadataDto, SelectOption } from '@crm-replica/shared';

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function formatCurrency(value: CurrencyValue | null | undefined): string {
  if (!value || value.amount === null) return '';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: value.currency ?? 'USD',
      maximumFractionDigits: Number.isInteger(value.amount) ? 0 : 2,
    }).format(value.amount);
  } catch {
    return `${formatNumber(value.amount)} ${value.currency ?? ''}`.trim();
  }
}

/** 'YYYY-MM-DD' shown as a local date without time-zone shifting. */
export function formatDate(value: string): string {
  const [y, m, d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(y, m - 1, d));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

/** ISO string → value for <input type="datetime-local"> in the browser's time zone. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) → ISO string. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Makes `acme.com` clickable as `https://acme.com`. */
export function linkHref(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** Shows a link without the protocol and trailing slash. */
export function linkLabel(value: string): string {
  return value.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function optionFor(field: FieldMetadataDto, value: unknown): SelectOption | undefined {
  return field.options?.find((o) => o.value === value);
}
