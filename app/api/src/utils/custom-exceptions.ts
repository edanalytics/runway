import {
  StatusResponse,
  StatusResponseForceDelete,
  StatusResponseFormValidation,
  StatusResponseGeneral,
  formValidationResult,
} from '@edanalytics/utils';
import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';

@Catch(HttpException)
export class HttpExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

export class CustomHttpException extends HttpException {
  constructor(info: StatusResponseGeneral, status: number);
  constructor(info: StatusResponseFormValidation);
  constructor(info: StatusResponseForceDelete);
  constructor(info: StatusResponse, status?: number) {
    super(
      info.type === 'ValidationError' ? { ...info, title: 'Invalid submission.' } : info,
      info.type === 'ValidationError'
        ? 400
        : info.type === 'RequiresForceDelete'
        ? 409
        : status ?? 500 // 500 added to satisfy TS. Earlier checks on info.type should prevent 500 from being used
    );
  }
}

/**
 * Throw validation errors for react-hook-form to display. Supply the optional
 * type argument to guarantee correctness of `field` strings.
 */
export class ValidationHttpException<
  BodyType extends object = Record<string, any>
> extends CustomHttpException {
  constructor(...errors: { field: keyof BodyType; message: string }[]);
  constructor(error: string);
  constructor(...errors: [string] | { field: keyof BodyType; message: string }[]) {
    super({
      type: 'ValidationError',
      title: 'Invalid submission.',
      data: { errors: formValidationResult(...(errors as any)) },
    });
  }
}

export class CustomNotFoundException extends CustomHttpException {
  constructor(message?: string) {
    super(
      {
        type: 'Error',
        title: 'Not found',
        message,
      },
      404
    );
  }
}

export class CustomUnauthorizedException extends CustomHttpException {
  constructor(message?: string) {
    super(
      {
        type: 'Error',
        title: 'Unauthorized',
        message,
      },
      403
    );
  }
}
export class CustomUnauthenticatedException extends CustomHttpException {
  constructor(message?: string) {
    super(
      {
        type: 'Error',
        title: 'Unauthenticated',
        message,
      },
      401
    );
  }
}
export class CustomServerErrorException extends CustomHttpException {
  constructor(message?: string) {
    super(
      {
        type: 'Error',
        title: 'Unknown internal server error',
        message,
      },
      500
    );
  }
}

export class CustomBadRequestException extends CustomHttpException {
  constructor(message?: string) {
    super(
      {
        type: 'Error',
        title: 'Bad request',
        message,
      },
      400
    );
  }
}
