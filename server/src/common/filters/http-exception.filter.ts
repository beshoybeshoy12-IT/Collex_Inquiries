import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { isProduction } from '../config/env';
import { MissingTenantContextError } from '../../prisma/tenant-guard';

/**
 * The single exit for every failure.
 *
 * Two rules it exists to enforce:
 *
 *  1. A client never sees a stack trace, a SQL fragment or a Prisma error code.
 *    Those go to the log with everything needed to find the request; the client
 *    gets a sentence it can show a user. This database holds national ids and
 *    home addresses — an unhandled error that echoes a query string back is a
 *    disclosure, not a debugging aid.
 *
 *  2. Log levels mean something. Every 4xx logged at `error` is how real
 *    incidents drown in rejected form submissions, so only a 5xx is an error;
 *    401/403 are warnings worth watching in aggregate; the rest is debug.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string; user?: any }>();

    const { status, message, errorCode, details } = this.translate(exception);

    const context = {
      method: request?.method,
      url: request?.originalUrl || request?.url,
      requestId: request?.id,
      principalId: request?.user?.id,
      tenantId: request?.user?.tenantId,
      statusCode: status,
    };

    const summary = Array.isArray(message) ? message.join(', ') : message;
    const line =
      `${status} ${context.method ?? '?'} ${context.url ?? '?'} — ${summary}` +
      (context.principalId ? ` [principal ${context.principalId}` : '') +
      (context.principalId && context.tenantId
        ? ` tenant ${context.tenantId}]`
        : context.principalId
          ? ']'
          : '') +
      (context.requestId ? ` (req ${context.requestId})` : '');

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        line,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (
      status === HttpStatus.UNAUTHORIZED ||
      status === HttpStatus.FORBIDDEN
    ) {
      this.logger.warn(line);
    } else {
      this.logger.debug(line);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...(errorCode ? { errorCode } : {}),
      // Structured detail the caller needs in order to act: which form fields
      // failed, which rows duplicated, which companies an ambiguous email
      // matches. Dropping these would leave the client with a sentence where it
      // needs a list, and it is why those exceptions are thrown with an object
      // rather than a string in the first place.
      ...details,
      timestamp: new Date().toISOString(),
      path: context.url,
      ...(context.requestId ? { requestId: context.requestId } : {}),
    });
  }

  /**
   * Turn anything throwable into a status, a safe message and an optional
   * machine-readable code.
   */
  private translate(exception: unknown): {
    // HttpStatus rather than number, so comparing against HttpStatus.FORBIDDEN
    // below is an enum-to-enum comparison. `getStatus()` returns a plain
    // number, which is what made those reads unchecked.
    status: HttpStatus;
    message: string | string[];
    errorCode?: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();

      if (typeof res !== 'object' || res === null) {
        return { status: exception.getStatus(), message: exception.message };
      }

      // Everything the thrower attached except the fields the envelope owns.
      // `error` is Nest's own status text ("Bad Request") and is redundant
      // beside `statusCode`.
      const {
        message: _message,
        statusCode: _statusCode,
        error: _error,
        errorCode,
        ...details
      } = res as Record<string, unknown>;

      return {
        status: exception.getStatus(),
        message:
          ('message' in res
            ? (res as { message: string | string[] }).message
            : exception.message) ?? exception.message,
        errorCode: errorCode as string | undefined,
        details: Object.keys(details).length > 0 ? details : undefined,
      };
    }

    // A tenant-scoped query that ran with no context is a wiring bug, and one
    // that must never be papered over — it is the failure mode the whole guard
    // exists to make loud.
    if (exception instanceof MissingTenantContextError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'خطأ داخلي في النظام - Internal server error',
        errorCode: 'TENANT_CONTEXT_MISSING',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.translatePrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      // The message contains the offending query. Never forwarded.
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'طلب غير صالح - Invalid request',
        errorCode: 'INVALID_QUERY',
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: isProduction()
        ? 'خطأ داخلي في النظام - Internal server error'
        : exception instanceof Error
          ? exception.message
          : 'Internal server error',
    };
  }

  /**
   * Prisma's error codes, mapped to statuses a client can act on.
   *
   * The field names in `meta` are safe to surface — they are column names the
   * client already knows from the DTO — but the message text is not, so it is
   * rebuilt rather than forwarded.
   */
  private translatePrisma(error: Prisma.PrismaClientKnownRequestError): {
    status: number;
    message: string;
    errorCode: string;
  } {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(', ')
      : undefined;

    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          message: target
            ? `القيمة مستخدمة بالفعل (${target}) - Value already exists (${target})`
            : 'القيمة مستخدمة بالفعل - Value already exists',
          errorCode: 'UNIQUE_VIOLATION',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'مرجع غير صالح - Referenced record does not exist',
          errorCode: 'FOREIGN_KEY_VIOLATION',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'السجل غير موجود - Record not found',
          errorCode: 'NOT_FOUND',
        };
      case 'P2034':
        return {
          status: HttpStatus.CONFLICT,
          message:
            'تعارض في المعاملة، يرجى المحاولة مرة أخرى - Transaction conflict, please retry',
          errorCode: 'TRANSACTION_CONFLICT',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'خطأ في قاعدة البيانات - Database error',
          errorCode: 'DATABASE_ERROR',
        };
    }
  }
}
