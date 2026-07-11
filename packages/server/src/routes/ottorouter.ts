import type { Hono } from 'hono';
import { registerOttoRouterBillingRoutes } from './ottorouter/billing.ts';
import { registerOttoRouterDeviceRoutes } from './ottorouter/devices.ts';
import { registerOttoRouterTopupRoutes } from './ottorouter/topup.ts';
import { registerOttoRouterWalletRoutes } from './ottorouter/wallet.ts';

export function registerOttoRouterRoutes(app: Hono) {
	registerOttoRouterWalletRoutes(app);
	registerOttoRouterDeviceRoutes(app);
	registerOttoRouterBillingRoutes(app);
	registerOttoRouterTopupRoutes(app);
}
