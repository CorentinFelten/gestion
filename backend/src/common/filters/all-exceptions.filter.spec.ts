import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Minimal ArgumentsHost/Response doubles for the HTTP context. */
function makeHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = { method: 'POST', url: '/transactions' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeEach(() => {
    // Silence + assert server-side logging without noise.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns a generic body (no internal message/name) on a non-HttpException 500', () => {
    const { host, json, status } = makeHost();
    const logSpy = jest.spyOn(Logger.prototype, 'error');

    // Simulate an internal error whose message leaks internals (e.g. Prisma).
    filter.catch(
      new Error('Invalid `prisma.session.findUnique()`, column "secret_col" does not exist'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('InternalServerError');
    expect(body.message).toBe('Internal server error');
    // The raw internal message/name must never reach the client.
    expect(JSON.stringify(body)).not.toContain('prisma');
    expect(JSON.stringify(body)).not.toContain('secret_col');
    // Full error/stack is still logged server-side.
    expect(logSpy).toHaveBeenCalled();
  });

  it('preserves the client message for deliberate HttpExceptions (4xx)', () => {
    const { host, json, status } = makeHost();

    filter.catch(new BadRequestException('displayName is required'), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.message).toBe('displayName is required');
  });
});
