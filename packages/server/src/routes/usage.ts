import type { Hono } from 'hono';
import { registerGlobalUsageRoute } from './usage/global.ts';
import { registerProjectUsageRoute } from './usage/project.ts';

export function registerUsageRoutes(app: Hono) {
	registerProjectUsageRoute(app);
	registerGlobalUsageRoute(app);
}
