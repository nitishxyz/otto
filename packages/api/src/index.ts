/**
 * @ottocode/api - Type-safe API client for ottocode server
 *
 * This package provides a fully typed API client generated from the OpenAPI spec
 * using @hey-api/openapi-ts with Axios client support.
 *
 * The client uses Axios for HTTP requests and provides:
 * - Type-safe SDK functions for all API endpoints
 * - Runtime schemas for validation
 * - SSE streaming utilities
 * - Error handling helpers
 */

// Re-export generated types
export * from './generated/types.gen';

// Re-export the Axios client instance and SDK functions
// The client is pre-configured but can be customized via client.setConfig()
export { client } from './generated/client.gen';

// Re-export all SDK functions for type-safe API calls
// These are tree-shakeable function exports
export * from './generated/sdk.gen';

// Re-export schemas (for runtime validation if needed)
export * from './generated/schemas.gen';

// Export SSE utilities
export {
	buildClientEventsStreamUrl,
	buildProjectEventsStreamUrl,
	buildSessionStreamUrl,
	createClientEventsStream,
	createSSEStream,
	isClientEvent,
	isServerEvent,
	parseSSEEvent,
} from './streaming';
export type {
	ClientEvent,
	ClientEventsStreamOptions,
	NotificationAction,
	NotificationEvent,
	NotificationLevel,
	SSEEvent,
	SSEStreamOptions,
	ServerEvent,
	SessionStatusEvent,
} from './streaming';

// Export helpers
export { isApiError, handleApiError } from './utils';
export type { ApiError } from './utils';

/**
 * Quick Start Example:
 *
 * ```typescript
 * import { client, getSessions } from '@ottocode/api';
 *
 * // Configure the client
 * client.setConfig({
 *   baseURL: 'http://localhost:3000',
 *   // Optional: add interceptors, auth, etc.
 * });
 *
 * // Make API calls
 * const { data, error } = await getSessions();
 * if (error) {
 *   console.error('Failed to fetch sessions:', error);
 * } else {
 *   console.log('Sessions:', data);
 * }
 * ```
 */
