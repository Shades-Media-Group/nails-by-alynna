import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../../context';
import { STAFF_ROLES, requireAuth, requireRole } from '../../middleware/auth';
import { demoMask } from '../../middleware/demo-mask';
import { adminAppointmentRoutes } from './appointments';
import { adminLoyaltyRoutes } from '../loyalty/routes';
import { adminCatalogRoutes } from './catalog';
import { adminClientRoutes } from './clients';
import { dashboardRoutes } from './dashboard';
import { adminSettingsRoutes } from './settings';
import { adminTeamRoutes } from './team';
import { adminAuditRoutes, adminUserRoutes } from './users';

/**
 * /api/admin — staff area. `admin` runs the day (bookings, clients, time off);
 * `administrator` additionally owns catalog, team, settings, roles and the audit log.
 */
export function adminRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps), requireRole(...STAFF_ROLES), demoMask);

  app.route('/stats', dashboardRoutes(deps));
  app.route('/appointments', adminAppointmentRoutes(deps));
  app.route('/clients', adminClientRoutes(deps));
  app.route('/catalog', adminCatalogRoutes(deps));
  app.route('/team', adminTeamRoutes(deps));
  app.route('/settings', adminSettingsRoutes(deps));
  app.route('/loyalty', adminLoyaltyRoutes(deps));

  const ownerOnly = requireRole('administrator');
  for (const path of ['/users', '/users/*', '/audit', '/audit/*']) app.use(path, ownerOnly);
  app.route('/users', adminUserRoutes(deps));
  app.route('/audit', adminAuditRoutes(deps));

  return app;
}
