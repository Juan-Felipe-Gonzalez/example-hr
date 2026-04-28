import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    /**
     * Catches all exceptions and formats them as RFC 7807 Problem Details.
     * Provides standardized error responses with type, title, status, detail, and instance.
     * Handles both HttpExceptions and generic errors.
     */
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const detail =
      typeof payload === 'string'
        ? payload
        : typeof payload === 'object' &&
            payload !== null &&
            'message' in payload &&
            typeof payload.message === 'string'
          ? payload.message
          : exception instanceof Error
            ? exception.message
            : 'An unexpected error occurred.';

    const title =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : this.getTitleForStatus(status);

    const type = this.getTypeForStatus(status);

    response.status(status).json({
      type,
      title,
      status,
      detail,
      instance: request.originalUrl ?? request.url,
    });
  }

  private getTypeForStatus(status: number): string {
    const rfc7231Base = 'https://tools.ietf.org/html/rfc7231#section-';
    switch (status) {
      case 400:
        return rfc7231Base + '6.5.1';
      case 404:
        return rfc7231Base + '6.5.4';
      case 409:
        return rfc7231Base + '6.5.8';
      case 422:
        return rfc7231Base + '6.5.10';
      case 500:
        return rfc7231Base + '6.6.1';
      case 503:
        return rfc7231Base + '6.6.4';
      default:
        return `https://httpstatuses.com/${status}`;
    }
  }

  private getTitleForStatus(status: number): string {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Unprocessable Entity';
      case 500:
        return 'Internal Server Error';
      case 503:
        return 'Service Unavailable';
      default:
        return 'Error';
    }
  }
}

