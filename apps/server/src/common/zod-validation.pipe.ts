import { BadRequestException, PipeTransform } from '@nestjs/common';
import { formatZodIssues } from '@crm-replica/shared';
import { z } from 'zod';

/** Validates (and normalizes) a request body with a zod schema shared with the web app and SDK. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: formatZodIssues(result.error),
      });
    }
    return result.data;
  }
}
