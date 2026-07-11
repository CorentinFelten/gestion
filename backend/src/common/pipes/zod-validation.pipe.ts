import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validates & parses a payload against a zod schema. REAL implementation.
 *
 * Usage:
 *   @Post()
 *   create(@Body(new ZodValidationPipe(CreateFooSchema)) body: CreateFooDto) {}
 *
 * Feature agents define their zod schemas + infer their DTO types and pass the
 * schema to this pipe. Keeps validation declarative and consistent app-wide.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: err.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      throw err;
    }
  }
}
