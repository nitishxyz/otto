import { timingSafeEqual } from 'node:crypto';

const FLOW_TTL_MS = 10 * 60 * 1000;

interface MCPAuthFlow {
	id: string;
	name: string;
	projectRoot: string;
	expectedState: string;
	callbackUrl: string;
	expiresAt: number;
}

const flows = new Map<string, MCPAuthFlow>();

function statesMatch(expected: string, actual: string): boolean {
	const expectedBytes = Buffer.from(expected);
	const actualBytes = Buffer.from(actual);
	return (
		expectedBytes.byteLength === actualBytes.byteLength &&
		timingSafeEqual(expectedBytes, actualBytes)
	);
}

function removeExpiredFlows(now = Date.now()): void {
	for (const [id, flow] of flows) {
		if (flow.expiresAt <= now) flows.delete(id);
	}
}

/** Creates a one-time daemon-owned MCP OAuth completion flow. */
export function createMCPAuthFlow(options: {
	name: string;
	projectRoot: string;
	authUrl: string;
	callbackUrl: string;
}): { flowId: string; callbackUrl: string; expiresAt: number } {
	removeExpiredFlows();
	const expectedState = new URL(options.authUrl).searchParams.get('state');
	if (!expectedState) {
		throw new Error('MCP OAuth server did not provide a state parameter');
	}
	for (const [id, flow] of flows) {
		if (
			flow.name === options.name &&
			flow.projectRoot === options.projectRoot
		) {
			flows.delete(id);
		}
	}
	const flow: MCPAuthFlow = {
		id: crypto.randomUUID(),
		name: options.name,
		projectRoot: options.projectRoot,
		expectedState,
		callbackUrl: options.callbackUrl,
		expiresAt: Date.now() + FLOW_TTL_MS,
	};
	flows.set(flow.id, flow);
	return {
		flowId: flow.id,
		callbackUrl: flow.callbackUrl,
		expiresAt: flow.expiresAt,
	};
}

/** Claims and removes an MCP OAuth flow after validating its callback state. */
export function claimMCPAuthFlow(flowId: string, state: string): MCPAuthFlow {
	removeExpiredFlows();
	const flow = flows.get(flowId);
	if (!flow) throw new Error('OAuth flow expired or invalid');
	if (!statesMatch(flow.expectedState, state)) {
		throw new Error('OAuth callback state mismatch');
	}
	flows.delete(flowId);
	return flow;
}

export function clearMCPAuthFlows(): void {
	flows.clear();
}
