import type { Hono } from 'hono';
import { registerSessionCrudRoutes } from './sessions/crud.ts';
import { registerSessionQueueRoutes } from './sessions/queue.ts';
import { registerSessionRetryRoutes } from './sessions/retry.ts';
import { registerSessionShareRoutes } from './sessions/share.ts';

export function registerSessionsRoutes(app: Hono) {
	registerSessionCrudRoutes(app);
	registerSessionQueueRoutes(app);
	registerSessionShareRoutes(app);
	registerSessionRetryRoutes(app);
}
