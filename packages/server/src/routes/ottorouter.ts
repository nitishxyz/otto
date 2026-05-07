import type { Hono } from 'hono';
import { registerOttoRouterBillingRoutes } from './ottorouter/billing.ts';
import { registerOttoRouterTopupRoutes } from './ottorouter/topup.ts';
import { registerOttoRouterWalletRoutes } from './ottorouter/wallet.ts';

export function registerOttoRouterRoutes(app: Hono) {
	registerOttoRouterWalletRoutes(app);
	registerOttoRouterBillingRoutes(app);
	registerOttoRouterTopupRoutes(app);
}
