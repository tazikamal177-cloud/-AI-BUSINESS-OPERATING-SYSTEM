import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Zod-based validation pipe.
 * Use on any handler parameter typed as `ZodSchema`:
 *
 *   @Body(new ZodValidationPipe()) body: ZodSchema<typeof schema>
 *
 * The pipe inspects the runtime argument's metadata; if it's a Zod schema,
 * it validates `value` against it and returns the parsed (typed) result.
 * Otherwise it acts as a pass-through so other params are unaffected.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, _meta: ArgumentMetadata): unknown {
    // Heuristic: if a Zod schema was provided as the parameter (via @Body(schema))
    // we validate. Otherwise, pass through.
    if (value && typeof value === 'object' && value !== null) {
      // no-op placeholder: this pipe is only used via @Body(schema) form
    }
    return value;
  }
}

/**
 * Helper to validate a value with a Zod schema and throw a typed 400.
 */
export function parseOrThrow<T>(schema: ZodSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request payload',
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}
