import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as { message?: string | string[]; error?: string };
        message = obj.message ?? exception.message;
        error = obj.error ?? exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          error = 'Conflict';
          message = 'A record with this value already exists.';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          error = 'NotFound';
          message = 'Resource not found.';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          error = 'BadRequest';
          message = 'Foreign key constraint failed.';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          error = 'PrismaError';
          message = `Database error: ${exception.code}`;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      error = 'ValidationError';
      message = 'Invalid input passed to database.';
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    const body: ErrorBody = {
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    if (status >= 500) {
      // Report only real server errors to Sentry/GlitchTip (no-op without DSN).
      // Response shape is unchanged — this is purely observability.
      Sentry.captureException(exception);
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${error}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} → ${status} ${error}`);
    }

    response.status(status).json(body);
  }
}
