import type { Hono } from 'hono';
import { registerAbortSessionRoute } from './queue/abort.ts';
import { registerRemoveQueuedMessageRoute } from './queue/remove.ts';
import { registerSendQueuedMessageNowRoute } from './queue/send-now.ts';
import { registerSessionQueueStatusRoute } from './queue/status.ts';

export function registerSessionQueueRoutes(app: Hono) {
	registerAbortSessionRoute(app);
	registerSessionQueueStatusRoute(app);
	registerSendQueuedMessageNowRoute(app);
	registerRemoveQueuedMessageRoute(app);
}
