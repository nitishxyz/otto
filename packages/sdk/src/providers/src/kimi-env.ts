/**
 * Browser-safe Kimi env helpers. Kept separate from kimi-client.ts so the
 * `@ottocode/sdk/browser` graph (utils -> registry -> env) never pulls in the
 * OAuth fetch chain, which depends on Bun-only auth modules.
 */
export function readKimiApiKeyFromEnv(): string {
	return typeof process !== 'undefined' ? (process.env.KIMI_API_KEY ?? '') : '';
}
