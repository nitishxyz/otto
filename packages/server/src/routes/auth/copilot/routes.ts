import type { Hono } from 'hono';
import { registerCopilotDeviceRoutes } from './device.ts';
import { registerCopilotDiagnosticsRoute } from './diagnostics.ts';
import { registerCopilotGhImportRoute } from './gh-import.ts';
import { registerCopilotMethodsRoute } from './methods.ts';
import { registerCopilotTokenRoute } from './token.ts';

export function registerAuthCopilotRoutes(app: Hono) {
	registerCopilotDeviceRoutes(app);
	registerCopilotMethodsRoute(app);
	registerCopilotTokenRoute(app);
	registerCopilotGhImportRoute(app);
	registerCopilotDiagnosticsRoute(app);
}
