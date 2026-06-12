import type { Hono } from 'hono';
import { registerAuthCopilotRoutes } from './auth/copilot.ts';
import { registerAuthKimiRoutes } from './auth/kimi.ts';
import { registerAuthOAuthRoutes } from './auth/oauth.ts';
import { registerAuthOnboardingRoutes } from './auth/onboarding.ts';
import { registerAuthProviderRoutes } from './auth/providers.ts';
import { registerAuthStatusRoutes } from './auth/status.ts';
import { registerAuthWalletRoutes } from './auth/wallet.ts';

export function registerAuthRoutes(app: Hono) {
	registerAuthStatusRoutes(app);
	registerAuthWalletRoutes(app);
	registerAuthProviderRoutes(app);
	registerAuthOAuthRoutes(app);
	registerAuthCopilotRoutes(app);
	registerAuthKimiRoutes(app);
	registerAuthOnboardingRoutes(app);
}
