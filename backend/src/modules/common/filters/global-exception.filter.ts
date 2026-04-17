import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
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
    let errors: any[] | undefined = undefined;

    // Handle NestJS HttpException
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || message;
        error = responseObj.error || error;
        errors = responseObj.errors;
      }
    }
    // Handle Prisma errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      status = HttpStatus.BAD_REQUEST;
      message = this.handlePrismaError(exception);
      error = 'Database Error';
    }
    // Handle Prisma validation error
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid data provided';
      error = 'Validation Error';
    }
    // Handle other errors
    else if (exception instanceof Error) {
      message = exception.message || message;

      // Log non-HTTP errors for debugging
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error(
          `Unhandled exception: ${exception.message}`,
          exception.stack,
        );
      }
    }

    const responseBody: any = {
      statusCode: status,
      error,
      message: Array.isArray(message) ? message : [message],
      path: request.url,
      timestamp: new Date().toISOString(),
      method: request.method,
    };

    if (errors) {
      responseBody.errors = errors;
    }

    // Don't expose internal error details in production
    if (
      status === HttpStatus.INTERNAL_SERVER_ERROR &&
      process.env[ENV.NODE_ENV] === 'production'
    ) {
      responseBody.message = ['Internal server error'];
    }

    response.status(status).json(responseBody);
  }

  private handlePrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): string {
    switch (exception.code) {
      case 'P2002':
        return `A record with this value already exists`;
      case 'P2003':
        return `Related record not found`;
      case 'P2005':
        return `Invalid value for field`;
      case 'P2006':
        return `Invalid value provided`;
      case 'P2014':
        return `Record violates constraint`;
      case 'P2025':
        return `Record not found`;
      default:
        return `Database error: ${exception.message}`;
    }
  }
}
