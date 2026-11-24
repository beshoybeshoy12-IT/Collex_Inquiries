import { generateKeyPairSync } from 'node:crypto';
import { FcmPushDriver, classifyFailure } from './fcm.driver';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  projectId: 'collex-test',
  clientEmail: 'push@collex-test.iam.gserviceaccount.com',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

function json(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('FcmPushDriver', () => {
  it('exchanges one OAuth token for a whole batch and reports each message', async () => {
    const http = jest.fn((url: string) => {
      if (url.includes('oauth2')) {
        return json(200, { access_token: 'ya29.test', expires_in: 3600 });
      }
      return json(200, { name: 'projects/collex-test/messages/1' });
    });
    const driver = new FcmPushDriver(account, http);

    const results = await driver.send([
      { token: 'a', title: 't', body: 'b' },
      { token: 'b', title: 't', body: 'b', highPriority: true },
    ]);
    await driver.send([{ token: 'c', title: 't', body: 'b' }]);

    expect(results.map((r) => r.outcome)).toEqual(['SENT', 'SENT']);
    // One exchange across both batches: the token is cached.
    expect(
      http.mock.calls.filter(([url]) => url.includes('oauth2')),
    ).toHaveLength(1);

    const sendCall = http.mock.calls.find(
      ([url]) => !url.includes('oauth2'),
    ) as unknown as [string, RequestInit];
    expect(sendCall[0]).toContain('/v1/projects/collex-test/messages:send');
    expect((sendCall[1].headers as Record<string, string>).Authorization).toBe(
      'Bearer ya29.test',
    );
  });

  it('retires a token FCM says is unregistered, and only that one', async () => {
    const http = jest.fn((url: string, init?: RequestInit) => {
      if (url.includes('oauth2')) return json(200, { access_token: 'x' });
      const token = (
        JSON.parse(init?.body as string) as { message: { token: string } }
      ).message.token;
      return token === 'dead'
        ? json(404, {
            error: {
              message: 'Requested entity was not found.',
              details: [{ errorCode: 'UNREGISTERED' }],
            },
          })
        : json(200, {});
    });
    const driver = new FcmPushDriver(account, http);

    const results = await driver.send([
      { token: 'dead', title: 't', body: 'b' },
      { token: 'alive', title: 't', body: 'b' },
    ]);

    expect(results).toEqual([
      expect.objectContaining({ token: 'dead', outcome: 'UNREGISTERED' }),
      expect.objectContaining({ token: 'alive', outcome: 'SENT' }),
    ]);
  });

  it('fails every message — and retires none — when our credentials are rejected', async () => {
    const http = jest.fn(() =>
      json(400, { error: 'invalid_grant', error_description: 'Invalid JWT' }),
    );
    const driver = new FcmPushDriver(account, http);

    const results = await driver.send([{ token: 'a', title: 't', body: 'b' }]);

    expect(results[0].outcome).toBe('FAILED');
    expect(results[0].detail).toContain('Invalid JWT');
  });

  it('does not retire a handset over a quota or server error', () => {
    expect(
      classifyFailure(429, { error: { status: 'RESOURCE_EXHAUSTED' } }),
    ).toBe('FAILED');
    expect(classifyFailure(503, null)).toBe('FAILED');
    expect(
      classifyFailure(400, {
        error: {
          message:
            'The registration token is not a valid FCM registration token',
          details: [{ errorCode: 'INVALID_ARGUMENT' }],
        },
      }),
    ).toBe('UNREGISTERED');
    // A bad payload of ours is INVALID_ARGUMENT too — but not about the token.
    expect(
      classifyFailure(400, {
        error: {
          message: 'Invalid JSON payload',
          details: [{ errorCode: 'INVALID_ARGUMENT' }],
        },
      }),
    ).toBe('FAILED');
  });
});
