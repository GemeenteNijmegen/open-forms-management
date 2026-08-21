import { xRayTraceId } from '../xRayTraceId';

describe('xRayTraceId', () => {
  const originalEnv = process.env._X_AMZN_TRACE_ID;

  afterEach(() => {
    process.env._X_AMZN_TRACE_ID = originalEnv;
  });

  it('extracts the Root segment from the Lambda-provided trace header', () => {
    process.env._X_AMZN_TRACE_ID = 'Root=1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e;Parent=53995c3f42cd8ad8;Sampled=1';

    expect(xRayTraceId()).toBe('1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e');
  });

  it('falls back to a placeholder when the header is not set', () => {
    delete process.env._X_AMZN_TRACE_ID;

    expect(xRayTraceId()).toBe('no-trace-id');
  });
});
