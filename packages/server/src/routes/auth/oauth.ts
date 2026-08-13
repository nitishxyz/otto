import type { Hono } from 'hono';
import { registerOAuthCallbackRoute } from './oauth/callback.ts';
import {
	registerOpenAIDeviceRoutes,
	registerOttoRouterDeviceRoutes,
	registerXaiDeviceRoutes,
} from './oauth/device.ts';
import { registerOAuthExchangeRoute } from './oauth/exchange.ts';
import { registerOAuthStartRoute } from './oauth/start.ts';
import { registerOAuthUrlRoute } from './oauth/url.ts';

export function registerAuthOAuthRoutes(app: Hono) {
	registerOpenAIDeviceRoutes(app);
	registerXaiDeviceRoutes(app);
	registerOttoRouterDeviceRoutes(app);
	registerOAuthUrlRoute(app);
	registerOAuthExchangeRoute(app);
	registerOAuthStartRoute(app);
	registerOAuthCallbackRoute(app);
}
