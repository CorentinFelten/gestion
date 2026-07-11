import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Global exception filter, normalizes every error into a consistent JSON shape:
 *   { statusCode, error, message, path, timestamp }
 * Feature agents can throw standard Nest HttpExceptions and get consistent output.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: unknown = 'Internal server error';
    let error = 'InternalServerError';
    // Extra keys attached to a deliberate HttpException body (e.g. the `errors`
    // array from ZodValidationPipe). Preserved so field-level validation detail
    // reaches the client. Only ever populated from an HttpException we threw, so
    // this never surfaces internal (Prisma/driver) details.
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      error = exception.name;
      if (typeof body === 'string') {
        message = body;
      } else {
        const record = body as Record<string, unknown>;
        message = record.message ?? body;
        const { message: _m, statusCode: _s, error: _e, ...rest } = record;
        extra = rest;
      }
    }
    // For any non-HttpException (status stays 500), we deliberately keep the
    // generic `message`/`error` defaults above and never surface
    // `exception.message`/`exception.name` to the client, those can leak
    // internal details (Prisma/driver strings, schema/constraint names, etc.).
    // The full error + stack are still logged server-side below (SEC-05).

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        (exception as Error)?.stack ?? String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      ...extra,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
