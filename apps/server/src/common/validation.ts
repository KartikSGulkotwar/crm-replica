import { Transform } from 'class-transformer';
import { ValidateBy, ValidationOptions } from 'class-validator';

/** Trims surrounding whitespace from string input. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and lowercases an email address. */
export const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** Limits a string by its UTF-8 byte length (bcrypt, for example, only reads 72 bytes). */
export const MaxBytes = (max: number, options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'maxBytes',
      constraints: [max],
      validator: {
        validate: (value) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
        defaultMessage: () => `$property must be at most ${max} bytes`,
      },
    },
    options,
  );
