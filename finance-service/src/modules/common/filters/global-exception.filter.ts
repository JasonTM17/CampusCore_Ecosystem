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
import { ENV } from '../../../config/env.constants';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, unknown>;
        const nestedMessage = responseObj.message;
        const nestedError = responseObj.error;
        message = typeof nestedMessage === 'string' ? nestedMessage : message;
        error = typeof nestedError === 'string' ? nestedError : error;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;
      message =
        exception.code === 'P2025'
          ? 'Record not found'
          : 'Database request failed';
      error = 'Database Error';
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      error = 'Validation Error';
    } else if (exception instanceof Error) {
      message = exception.message || message;
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `Unhandled exception: ${exception.message}`,
          exception.stack,
        );
      }
    }

    const responseBody = {
      statusCode: status,
      error,
      message: Array.isArray(message) ? message : [message],
      path: request.url,
      timestamp: new Date().toISOString(),
      method: request.method,
    };

    if (
      status === HttpStatus.INTERNAL_SERVER_ERROR &&
      process.env[ENV.NODE_ENV] === 'production'
    ) {
      response.status(status).json({
        ...responseBody,
        message: ['Internal server error'],
      });
      return;
    }

    response.status(status).json(responseBody);
  }
}
