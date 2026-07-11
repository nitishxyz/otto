export const OTTO_PROTOCOL_VERSION = 1;
export const OTTO_PROTOCOL_MIN_VERSION = 1;
export const OTTO_PROTOCOL_MAX_VERSION = 1;

export const OTTO_CLIENT_CAPABILITIES = [
	'projects.list',
	'remote.owner-session',
	'remote.upgrade.stage',
] as const;

export type CompatibilityStatus =
	| 'compatible'
	| 'limited-legacy'
	| 'host-too-old'
	| 'client-too-old'
	| 'unknown-legacy';

export interface ProtocolDescriptor {
	version?: number;
	minVersion?: number;
	maxVersion?: number;
	capabilities?: readonly string[];
}

export interface CompatibilityResult {
	status: CompatibilityStatus;
	missingCapabilities: string[];
	negotiatedProtocol: number | null;
}

/** Evaluates host/client wire compatibility without consulting product semver. */
export function evaluateCompatibility(
	host: ProtocolDescriptor | null | undefined,
	client: ProtocolDescriptor = {
		version: OTTO_PROTOCOL_VERSION,
		minVersion: OTTO_PROTOCOL_MIN_VERSION,
		maxVersion: OTTO_PROTOCOL_MAX_VERSION,
		capabilities: OTTO_CLIENT_CAPABILITIES,
	},
	requiredCapabilities: readonly string[] = [],
): CompatibilityResult {
	if (!host?.version && !host?.minVersion && !host?.maxVersion) {
		return {
			status: 'unknown-legacy',
			missingCapabilities: [...requiredCapabilities],
			negotiatedProtocol: null,
		};
	}
	const hostMin = host.minVersion ?? host.version ?? 0;
	const hostMax = host.maxVersion ?? host.version ?? hostMin;
	const clientMin = client.minVersion ?? client.version ?? 0;
	const clientMax = client.maxVersion ?? client.version ?? clientMin;
	if (hostMax < clientMin) {
		return {
			status: 'host-too-old',
			missingCapabilities: [],
			negotiatedProtocol: null,
		};
	}
	if (hostMin > clientMax) {
		return {
			status: 'client-too-old',
			missingCapabilities: [],
			negotiatedProtocol: null,
		};
	}
	const available = new Set(host.capabilities ?? []);
	const missingCapabilities = requiredCapabilities.filter(
		(capability) => !available.has(capability),
	);
	return {
		status:
			host.capabilities && missingCapabilities.length === 0
				? 'compatible'
				: 'limited-legacy',
		missingCapabilities,
		negotiatedProtocol: Math.min(hostMax, clientMax),
	};
}

export interface ClientIdentity {
	name: string;
	version: string;
}

/** Builds first-party identity headers for generated SDK requests. */
export function clientIdentityHeaders(
	identity: ClientIdentity,
): Record<string, string> {
	return {
		'X-Otto-Client': identity.name,
		'X-Otto-Client-Version': identity.version,
		'X-Otto-Protocol-Version': String(OTTO_PROTOCOL_VERSION),
		'X-Otto-Protocol-Min': String(OTTO_PROTOCOL_MIN_VERSION),
		'X-Otto-Protocol-Max': String(OTTO_PROTOCOL_MAX_VERSION),
	};
}
