import { paginate, PageEnvelope } from '../ObjectsPagination';

function page(results: number[], next: string | null = null): PageEnvelope<number> {
  return { results, next };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('paginate', () => {
  it('yields the results of a single page and stops at next: null', async () => {
    const fetchPage = jest.fn().mockResolvedValue(page([1, 2, 3]));

    const results = await collect(paginate('page1', fetchPage, (next) => next));

    expect(results).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('follows next across pages in order, sequentially', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page([1, 2], 'page2'))
      .mockResolvedValueOnce(page([3, 4], 'page3'))
      .mockResolvedValueOnce(page([5]));

    const results = await collect(paginate('page1', fetchPage, (next) => next));

    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls.map((call) => call[0])).toEqual(['page1', 'page2', 'page3']);
  });

  it('works generically for any item type, not just Objects resources', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ results: [{ label: 'a' }, { label: 'b' }], next: null });

    const results = await collect(paginate('page1', fetchPage, (next) => next));

    expect(results).toEqual([{ label: 'a' }, { label: 'b' }]);
  });

  it('validates every next URL before fetching it', async () => {
    const fetchPage = jest.fn().mockResolvedValue(page([1], 'raw-next'));
    const validateNextUrl = jest.fn().mockImplementation(() => {
      throw new Error('rejected next url');
    });

    await expect(collect(paginate('page1', fetchPage, validateNextUrl))).rejects.toThrow('rejected next url');
    expect(validateNextUrl).toHaveBeenCalledWith('raw-next');
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops fetching further pages as soon as the consumer breaks out of the loop', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page([1, 2], 'page2'))
      .mockResolvedValueOnce(page([3, 4], 'page3'));

    const results: number[] = [];
    for await (const item of paginate<number>('page1', fetchPage, (next) => next)) {
      results.push(item);
      if (item === 2) {
        break;
      }
    }

    expect(results).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('makes zero requests when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchPage = jest.fn();

    const results = await collect(paginate('page1', fetchPage, (next) => next, { signal: controller.signal }));

    expect(results).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('stops before fetching a next page once the caller aborts between pages', async () => {
    const controller = new AbortController();
    const fetchPage = jest.fn().mockImplementationOnce(async () => {
      controller.abort();
      return page([1], 'page2');
    });

    const results = await collect(paginate('page1', fetchPage, (next) => next, { signal: controller.signal }));

    expect(results).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
