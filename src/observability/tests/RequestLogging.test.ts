import { Context } from 'aws-lambda';
import { logger } from '../Logger';
import { bindRequestLogging, resetRequestLogging } from '../RequestLogging';

const fakeContext = { awsRequestId: 'test-request-id' } as unknown as Context;

describe('bindRequestLogging', () => {
  const originalTraceId = process.env._X_AMZN_TRACE_ID;

  afterEach(() => {
    process.env._X_AMZN_TRACE_ID = originalTraceId;
  });

  it('binds the Lambda context and the X-Ray-derived correlationId to the logger', () => {
    process.env._X_AMZN_TRACE_ID = 'Root=1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e;Parent=53995c3f42cd8ad8;Sampled=1';
    const addContextSpy = jest.spyOn(logger, 'addContext');
    const appendKeysSpy = jest.spyOn(logger, 'appendKeys');

    bindRequestLogging(fakeContext);

    expect(addContextSpy).toHaveBeenCalledWith(fakeContext);
    expect(appendKeysSpy).toHaveBeenCalledWith({ correlationId: '1-5e1b4151-5ac6c58e2f1c2a1c9a4e0f0e' });
  });
});

describe('resetRequestLogging', () => {
  it('clears the persistent keys added by bindRequestLogging', () => {
    const resetKeysSpy = jest.spyOn(logger, 'resetKeys');

    resetRequestLogging();

    expect(resetKeysSpy).toHaveBeenCalled();
  });
});
