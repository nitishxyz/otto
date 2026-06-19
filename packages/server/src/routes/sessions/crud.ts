import type { Hono } from 'hono';
import { registerCreateSessionRoute } from './crud/create.ts';
import { registerDeleteSessionRoute } from './crud/delete.ts';
import { registerGetSessionRoute } from './crud/get.ts';
import { registerListSessionsRoute } from './crud/list.ts';
import { registerUpdateSessionRoute } from './crud/update.ts';
import { registerMarkSessionViewedRoute } from './crud/viewed.ts';

export function registerSessionCrudRoutes(app: Hono) {
	registerListSessionsRoute(app);
	registerCreateSessionRoute(app);
	registerGetSessionRoute(app);
	registerMarkSessionViewedRoute(app);
	registerUpdateSessionRoute(app);
	registerDeleteSessionRoute(app);
}
