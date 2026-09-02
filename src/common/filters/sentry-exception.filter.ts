import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : (exception as Error)?.message || 'Internal server error';

    // Capture 500+ unhandled server errors to Sentry
    if (status >= 500) {
      this.logger.error(
        `Unhandled Exception [${request.method} ${request.url}]: ${JSON.stringify(message)}`,
        (exception as Error)?.stack,
      );

      if (process.env.SENTRY_DSN) {
        Sentry.withScope((scope) => {
          scope.setExtra('url', request.url);
          scope.setExtra('method', request.method);
          scope.setExtra('body', request.body);
          scope.setUser({ ip_address: request.ip });
          Sentry.captureException(exception);
        });
      }
    } else {
      this.logger.warn(
        `Client Error [${status}] [${request.method} ${request.url}]: ${JSON.stringify(message)}`,
      );
    }

    if (response && typeof response.status === 'function') {
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        error:
          typeof message === 'object'
            ? message
            : { message },
      });
    }
  }
}
