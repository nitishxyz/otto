import {
	evaluateCompatibility,
	type CompatibilityResult,
	type ProtocolDescriptor,
} from '@ottocode/api';

/** Stable host capability required to offer the explicit staged-upgrade action. */
export const REMOTE_UPGRADE_CAPABILITY = 'remote.upgrade.stage';

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface RemoteServerInfo {
	version: string | null;
	protocol?: ProtocolDescriptor & { capabilities?: string[] };
}

export type RemoteCompatibilityGate =
	| { kind: 'compatible'; result: CompatibilityResult }
	| { kind: 'limited'; result: CompatibilityResult; reason: string }
	| {
			kind: 'host-too-old';
			result: CompatibilityResult;
			hostVersion: string | null;
			/** Strictly newer official release to stage, or null when unavailable. */
			upgradeTarget: string | null;
			guidance: string;
	  }
	| {
			kind: 'client-too-old';
			result: CompatibilityResult;
			hostVersion: string | null;
	  };

/** True when `target` is a strictly newer official x.y.z release than `current`. */
export function isStrictlyNewerRelease(
	current: string | null | undefined,
	target: string | null | undefined,
): boolean {
	if (!current || !target) return false;
	if (
		!RELEASE_VERSION_PATTERN.test(current) ||
		!RELEASE_VERSION_PATTERN.test(target)
	) {
		return false;
	}
	const left = current.split('.').map(Number);
	const right = target.split('.').map(Number);
	for (let index = 0; index < 3; index++) {
		if ((right[index] ?? 0) > (left[index] ?? 0)) return true;
		if ((right[index] ?? 0) < (left[index] ?? 0)) return false;
	}
	return false;
}

/** Exact host-side guidance shown when no staged-upgrade capability exists. */
export function hostUpdateGuidance(machineName: string): string {
	return `Update otto on ${machineName}: run \`otto upgrade\` (or reinstall the latest release) on that machine, then restart its daemon and managed tunnel.`;
}

/**
 * Evaluates the remote host's advertised protocol against this client and
 * derives the desktop gate: proceed, proceed-with-limited-notice, or block
 * with the matching recovery path. `clientReleaseVersion` (the desktop's
 * bundled daemon release) is only used to compute a strictly newer official
 * upgrade target; it never relaxes the protocol verdict. `clientProtocol` is
 * injectable for tests and defaults to this client's shipped protocol.
 */
export function assessRemoteCompatibility(
	serverInfo: RemoteServerInfo | null | undefined,
	machineName: string,
	clientReleaseVersion?: string | null,
	clientProtocol?: ProtocolDescriptor,
): RemoteCompatibilityGate {
	const result = clientProtocol
		? evaluateCompatibility(serverInfo?.protocol, clientProtocol)
		: evaluateCompatibility(serverInfo?.protocol);
	const hostVersion = serverInfo?.version ?? null;
	switch (result.status) {
		case 'compatible':
			return { kind: 'compatible', result };
		case 'unknown-legacy':
			return {
				kind: 'limited',
				result,
				reason: `${machineName} runs an older otto daemon that predates compatibility reporting. Core features should work, but newer features may be unavailable until the machine is updated.`,
			};
		case 'limited-legacy':
			return {
				kind: 'limited',
				result,
				reason: `${machineName} supports this client but is missing some capabilities${
					result.missingCapabilities.length > 0
						? ` (${result.missingCapabilities.join(', ')})`
						: ''
				}. Affected features are disabled until the machine is updated.`,
			};
		case 'host-too-old': {
			const advertisesStaging =
				serverInfo?.protocol?.capabilities?.includes(
					REMOTE_UPGRADE_CAPABILITY,
				) ?? false;
			const upgradeTarget =
				advertisesStaging &&
				isStrictlyNewerRelease(hostVersion, clientReleaseVersion)
					? (clientReleaseVersion ?? null)
					: null;
			return {
				kind: 'host-too-old',
				result,
				hostVersion,
				upgradeTarget,
				guidance: hostUpdateGuidance(machineName),
			};
		}
		case 'client-too-old':
			return { kind: 'client-too-old', result, hostVersion };
	}
}
