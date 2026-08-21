export interface PageEnvelope<T> {
  next: string | null;
  results: T[];
}

export interface PaginateOptions {
  signal?: AbortSignal;
}

/**
 * Generic sequential pagination for any Objects-shaped page envelope
 * (`next` + `results`), reusable for every endpoint that follows this
 * contract, not just the one this client currently has. The caller decides
 * how a page is fetched and how a `next` URL is validated; `paginate`
 * itself only walks the pages.
 *
 * Breaking the consumer's `for await` loop stops this generator
 * immediately at its current `yield`, so no further page is ever fetched.
 */
export async function* paginate<T>(
  firstUrl: string,
  fetchPage: (url: string) => Promise<PageEnvelope<T>>,
  validateNextUrl: (next: string) => string,
  options: PaginateOptions = {},
): AsyncGenerator<T> {
  let url: string | null = firstUrl;

  while (url) {
    if (options.signal?.aborted) {
      return;
    }

    const page = await fetchPage(url);

    for (const item of page.results) {
      yield item;
    }

    url = page.next ? validateNextUrl(page.next) : null;
  }
}
