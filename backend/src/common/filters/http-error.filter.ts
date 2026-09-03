import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Global error filter.
 * - Normalizes all errors to the API contract: `{ success: false, error: { code, message, details? } }`
 * - Maps Prisma known errors (P2002 unique, P2025 not found) to proper HTTP codes.
 * - Never leaks stack traces in production.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as any).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null) {
        const r = resp as any;
        message = r.message || r.error || message;
        code = r.code || this.codeFromStatus(status);
        if (r.details) details = r.details;
      }
      if (!code || code === 'INTERNAL_ERROR') code = this.codeFromStatus(status);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const r = this.fromPrisma(exception);
      status = r.status;
      code = r.code;
      message = r.message;
      details = r.details;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      code = 'PRISMA_VALIDATION';
      message = 'Invalid query parameters';
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(
        `[${requestId ?? '-'}] ${req.method} ${req.url} → ${status} ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorBody = {
      success: false,
      error: { code, message, requestId, ...(details ? { details } : {}) },
    };
    res.status(status).json(body);
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'UNPROCESSABLE';
      case 429: return 'RATE_LIMITED';
      default:  return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }

  private fromPrisma(e: Prisma.PrismaClientKnownRequestError): {
    status: number; code: string; message: string; details?: unknown;
  } {
    switch (e.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: 'UNIQUE_VIOLATION',
          message: 'A record with these unique fields already exists',
          details: { target: (e.meta as any)?.target },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Record not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'FK_VIOLATION',
          message: 'Foreign key constraint violation',
          details: { field: (e.meta as any)?.field_name },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: `PRISMA_${e.code}`,
          message: 'Database error',
        };
    }
  }
}
