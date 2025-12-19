import { Logger } from '@nestjs/common';
import { CustomHttpException } from './custom-exceptions';

export const throwNotFound = (err: any) => {
  Logger.warn(err);
  throw new CustomHttpException({ title: 'Not found', type: 'Error' }, 404);
};

export const throwNotFoundMsg = (message: string) => (err: any) => {
  Logger.warn(err);
  throw new CustomHttpException({ title: 'Not found', message, type: 'Error' }, 404);
};
