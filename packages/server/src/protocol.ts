export const OTTO_PROTOCOL_VERSION = 1;
export const OTTO_PROTOCOL_MIN_VERSION = 1;
export const OTTO_PROTOCOL_MAX_VERSION = 1;

export const OTTO_SERVER_CAPABILITIES = [
	'projects.list',
	'remote.owner-session',
	'remote.upgrade.stage',
] as const;

/** Stable wire-protocol metadata, intentionally independent of product semver. */
export function getProtocolInfo() {
	return {
		version: OTTO_PROTOCOL_VERSION,
		minVersion: OTTO_PROTOCOL_MIN_VERSION,
		maxVersion: OTTO_PROTOCOL_MAX_VERSION,
		capabilities: [...OTTO_SERVER_CAPABILITIES],
	};
}
