import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';

/** The Executor's student match results batches; every other route keeps the 100kb default. */
const STUDENT_MATCH_RESULTS_BODY_LIMIT = '1mb';

// The prefix is optional because the integration tests mount routes without it.
const studentMatchResultsPath =
  /^(?:\/api)?\/earthbeam\/jobs\/[^/]+\/student-match-results\/?(?:\?|$)/i;

/**
 * Registers the app's JSON parsers. Call before app.init(): Nest skips its own
 * JSON parser once one is registered, so this registers the default one too.
 * The first parser to read a body wins, and the second skips it.
 */
export const useJsonBodyParsers = (app: NestExpressApplication) => {
  app.useBodyParser('json', {
    limit: STUDENT_MATCH_RESULTS_BODY_LIMIT,
    type: (req: Request) => studentMatchResultsPath.test(req.url) && !!req.is('application/json'),
  });
  app.useBodyParser('json');
};
