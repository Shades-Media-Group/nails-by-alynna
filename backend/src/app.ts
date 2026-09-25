import { Hono } from 'hono';
import type { AppDeps, AppEnv } from './context';
import { AppError } from './lib/errors';
import { apiSecurityHeaders, jsonBodyLimit, noStore, originGuard, requestContext } from './middleware/security';
import { adminRoutes } from './modules/admin';
import { appointmentRoutes } from './modules/appointments/routes';
import { authRoutes } from './modules/auth/routes';
import { availabilityRoutes } from './modules/availability/routes';
import { meRoutes } from './modules/me/routes';
import { publicRoutes } from './modules/public/routes';

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.use('*', requestContext(deps));
  app.use('/api/*', apiSecurityHeaders(deps), noStore, originGuard(deps), jsonBodyLimit);

  app.route('/api', publicRoutes(deps));
  app.route('/api/auth', authRoutes(deps));
  app.route('/api/me', meRoutes(deps));
  app.route('/api/availability', availabilityRoutes(deps));
  app.route('/api/appointments', appointmentRoutes(deps));
  app.route('/api/admin', adminRoutes(deps));

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

  app.onError((error, c) => {
    if (error instanceof AppError) {
      for (const [name, value] of Object.entries(error.headers ?? {})) c.header(name, value);
      return c.json(
        { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } },
        error.status as 400,
      );
    }
    const requestId = c.get('requestId');
    console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname} failed (request ${requestId})`, error);
    return c.json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } }, 500);
  });

  return app;
}
