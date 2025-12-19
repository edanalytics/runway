import { HttpException, HttpStatus } from '@nestjs/common';

// Note: the "@" symbols below are not actually @ because that messes with JSDoc. Don't copy/paste the code example.
/**
 * Set default HTTP status code and response for failures. Upstream
 * throws of nest HTTP errors pass through unchanged. Other arbitrary
 * errors are replaced with the default configured here before they
 * would otherwise be replaced with nest's own default of a 500.
 *
 * ___Note:___ This must be applied _underneath_ the nest HTTP method
 * decorator.
 *
 * ```
 * // Return a 418
 * ＠Get('<path>')
 * ＠ErrorResponse(new ImATeapotException("<response status text>"))
 * handler(){ }
 * ```
 */
export function ErrorResponse<ExceptionType extends HttpException>(
  fallbackException: ExceptionType
) {
  return function (target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const value = descriptor.value;
    descriptor.value = function (...args: unknown[]) {
      try {
        return value.apply(this, args);
      } catch (error: unknown) {
        if (
          error !== null &&
          typeof error === 'object' &&
          'status' in error &&
          typeof error.status === 'string' &&
          error.status in HttpStatus
        ) {
          throw error;
        } else {
          throw fallbackException;
        }
      }
    };
  };
}
