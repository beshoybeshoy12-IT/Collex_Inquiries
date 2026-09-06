/**
 * The API contract, in one place.
 *
 * Every successful reply is `{ success: true, data, timestamp }` and every
 * failure is `{ success: false, statusCode, message, timestamp }`. A paginated
 * reply keeps its `meta` alongside `data`. The web client and the future mobile
 * client both unwrap exactly this, so the shape is part of the public API and
 * not an implementation detail of the interceptor.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiFailure {
  success: false;
  statusCode: number;
  /** A string, or the array of strings `ValidationPipe` produces. */
  message: string | string[];
  /** Machine-readable discriminator for clients that branch on the failure. */
  errorCode?: string;
  timestamp: string;
  path?: string;
  requestId?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Build a paginated payload.
 *
 * `total` is the count *before* the page was taken, which is the only figure
 * that lets a client render "page 3 of 40". Passing the length of the current
 * page here is the classic mistake and would make every list claim one page.
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}
