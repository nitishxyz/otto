import type { Hono } from 'hono';
import { registerSimulatorActionRoutes } from './actions.ts';
import { registerSimulatorLifecycleRoutes } from './lifecycle.ts';
import { registerSimulatorLogsRoute } from './logs.ts';

export function registerSimulatorRoutes(app: Hono) {
	registerSimulatorLifecycleRoutes(app);
	registerSimulatorActionRoutes(app);
	registerSimulatorLogsRoute(app);
}
