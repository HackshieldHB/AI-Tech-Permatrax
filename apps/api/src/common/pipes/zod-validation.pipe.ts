import { PipeTransform, ArgumentMetadata, BadRequestException, Injectable } from '@nestjs/common';
import { ZodError, type ZodTypeAny } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schemaOverride?: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const schema =
      this.schemaOverride ??
      (metadata.metatype as { zodSchema?: ZodTypeAny; schema?: ZodTypeAny } | undefined)?.zodSchema ??
      (metadata.metatype as { schema?: ZodTypeAny } | undefined)?.schema;
    if (!schema) return value;

    try {
      return schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        const payload = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        throw new BadRequestException(payload);
      }
      throw new BadRequestException('Validation processing failed upstream due to malformed payload blocks');
    }
  }
}
