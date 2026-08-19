import {
	createRoute,
	type OpenAPIHono,
	type RouteConfig,
	type RouteHandler,
} from '@hono/zod-openapi';
import type { Handler, Hono, Next } from 'hono';

/**
 * Register an endpoint whose OpenAPI contract is derived from Zod schemas.
 */
export function zodOpenApiRoute<const R extends RouteConfig>(
	app: Hono,
	route: R,
	handler: (c: Parameters<RouteHandler<R>>[0], next: Next) => unknown,
): unknown;
export function zodOpenApiRoute(
	app: Hono,
	route: RouteConfig,
	handler: Handler,
): unknown;
export function zodOpenApiRoute(
	app: Hono,
	route: RouteConfig,
	handler: Handler,
) {
	const openApiApp = app as OpenAPIHono;
	return openApiApp.openapi(createRoute(route), handler as never);
}
