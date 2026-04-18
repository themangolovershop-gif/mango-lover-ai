import type { ZodTypeAny } from 'zod';

import { ValidationError } from '@/backend/shared/lib/errors/app-error';

export function validateWithSchema<T extends ZodTypeAny>(
  schema: T,
  input: unknown,
  message = 'Request validation failed.'
) {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError(message, parsed.error.flatten());
  }

  return parsed.data;
}
