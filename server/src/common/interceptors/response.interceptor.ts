import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful reply as `{ success, data, timestamp }`.
 *
 * Three things pass through untouched:
 *
 *  - a payload that already carries `success`, so a handler that built the
 *    envelope itself is not double-wrapped;
 *  - a payload carrying `meta`, which is how a paginated result keeps its
 *    `{ data, meta }` shape instead of becoming `{ data: { data, meta } }`;
 *  - a `StreamableFile`, because wrapping a stream in JSON produces `{}` and
 *    a download that silently yields an empty file is a bad afternoon.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;

        if (
          data &&
          typeof data === 'object' &&
          ('success' in data || 'meta' in data)
        ) {
          const payload = data as Record<string, unknown>;
          return {
            // A paginated payload carries `meta` but no `success`, and it must
            // keep `data` and `meta` at the top level rather than being nested
            // under a second `data`. It still gets `success: true` added, so
            // every reply in the API has the same discriminator and a client
            // never has to know which shape it is looking at to tell whether
            // the call worked.
            success: true,
            ...payload,
            timestamp: payload.timestamp ?? new Date().toISOString(),
          };
        }

        return {
          success: true,
          data: data ?? null,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
