import type { Hono } from 'hono';
import { registerMCPAuthRoutes } from './mcp/auth.ts';
import { registerMCPLifecycleRoutes } from './mcp/lifecycle.ts';
import { registerMCPServerConfigRoutes } from './mcp/servers.ts';

export function registerMCPRoutes(app: Hono) {
	registerMCPServerConfigRoutes(app);
	registerMCPLifecycleRoutes(app);
	registerMCPAuthRoutes(app);
}
