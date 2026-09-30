import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD } from '@/build-info';
import { newBuildOnServer } from './appUpdate';

const serve = (response: Response | Error) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
const versionJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('is a new build out?', () => {
  it('no, while the server has the build that is running', async () => {
    serve(versionJson({ version: BUILD.version, builtAt: BUILD.builtAt }));
    expect(await newBuildOnServer()).toBe(false);
    expect(fetch).toHaveBeenCalledWith('/version.json', { cache: 'no-store' });
  });

  it('yes, for a new version, and for the same version built again', async () => {
    serve(versionJson({ version: `${BUILD.version}-next`, builtAt: BUILD.builtAt }));
    expect(await newBuildOnServer()).toBe(true);
    serve(versionJson({ version: BUILD.version, builtAt: '2099-01-01T00:00:00.000Z' }));
    expect(await newBuildOnServer()).toBe(true);
  });

  it('no when it cannot tell: offline, an error page, something else', async () => {
    serve(new TypeError('Failed to fetch'));
    expect(await newBuildOnServer()).toBe(false);
    serve(versionJson({ error: 'down' }, 503));
    expect(await newBuildOnServer()).toBe(false);
    serve(versionJson({ service: 'nails-by-alynna-web' }));
    expect(await newBuildOnServer()).toBe(false);
    serve(new Response('<!doctype html>', { status: 200 }));
    expect(await newBuildOnServer()).toBe(false);
  });
});
