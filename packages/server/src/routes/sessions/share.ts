import type { Hono } from 'hono';
import { registerCreateShareRoute } from './share/create.ts';
import { registerDeleteShareRoute } from './share/delete.ts';
import { registerListSharesRoute } from './share/list.ts';
import { registerShareStatusRoute } from './share/status.ts';
import { registerSyncShareRoute } from './share/sync.ts';

export function registerSessionShareRoutes(app: Hono) {
	registerShareStatusRoute(app);
	registerCreateShareRoute(app);
	registerSyncShareRoute(app);
	registerDeleteShareRoute(app);
	registerListSharesRoute(app);
}
