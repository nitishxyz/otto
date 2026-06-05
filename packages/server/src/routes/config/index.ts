import type { Hono } from 'hono';
import { registerCwdRoute } from './cwd.ts';
import { registerMainConfigRoute } from './main.ts';
import { registerAgentsRoute } from './agents.ts';
import { registerProvidersRoute } from './providers.ts';
import { registerModelsRoutes } from './models.ts';
import { registerDefaultsRoute } from './defaults.ts';
import { registerDebugConfigRoute } from './debug.ts';
import { registerToolsRoute } from './tools.ts';

export function registerConfigRoutes(app: Hono) {
	registerCwdRoute(app);
	registerMainConfigRoute(app);
	registerAgentsRoute(app);
	registerToolsRoute(app);
	registerProvidersRoute(app);
	registerModelsRoutes(app);
	registerDefaultsRoute(app);
	registerDebugConfigRoute(app);
}
