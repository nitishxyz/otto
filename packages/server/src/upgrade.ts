import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { getOttoHomeDir } from '@ottocode/sdk';
import {
	compareReleaseVersions,
	getOfficialReleaseUrl,
	getReleaseAssetName,
	parseReleaseVersion,
} from '@ottocode/sdk/release';

export { compareReleaseVersions } from '@ottocode/sdk/release';

/** Validates the upgrade-only invariant before any network or filesystem work. */
export function assertUpgradeTarget(
	current: string | null,
	target: string,
): void {
	if (!current) throw new Error('Running daemon version is unknown');
	if (compareReleaseVersions(current, target) >= 0) {
		throw new Error('Target must be newer than the running daemon');
	}
}

function stagedUpgradePath(target: string): string {
	const version = parseReleaseVersion(target).version;
	return join(
		getOttoHomeDir(),
		'upgrades',
		version,
		getReleaseAssetName(platform(), arch()),
	);
}

export interface StagedUpgrade {
	status: 'staged';
	targetVersion: string;
	stagedPath: string;
	restartRequired: true;
}

/** Downloads only an official release asset and stages it for the daemon owner. */
export async function stageDaemonUpgrade(
	current: string | null,
	target: string,
	fetcher: typeof fetch = fetch,
): Promise<StagedUpgrade> {
	assertUpgradeTarget(current, target);
	const targetVersion = parseReleaseVersion(target).version;
	const destination = stagedUpgradePath(target);
	const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
	await mkdir(dirname(destination), { recursive: true });
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 60_000);
	try {
		const response = await fetcher(
			getOfficialReleaseUrl(target, platform(), arch()),
			{ redirect: 'follow', signal: controller.signal },
		);
		if (!response.ok || !response.body) {
			throw new Error(
				`Official release download failed (HTTP ${response.status})`,
			);
		}
		try {
			await Bun.write(temporary, await response.arrayBuffer());
			if (platform() !== 'win32') await chmod(temporary, 0o755);
			await rename(temporary, destination);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => {});
			throw new Error(
				`Unable to stage upgrade; check daemon install permissions: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} finally {
		clearTimeout(timeout);
	}
	return {
		status: 'staged',
		targetVersion,
		stagedPath: destination,
		restartRequired: true,
	};
}

/** Resolves a previously staged official binary for supervised activation. */
export async function resolveStagedDaemonUpgrade(
	current: string | null,
	target: string,
): Promise<string> {
	assertUpgradeTarget(current, target);
	const targetVersion = parseReleaseVersion(target).version;
	const path = stagedUpgradePath(target);
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) {
		throw new Error(`Otto v${targetVersion} is not staged on this machine`);
	}
	if (platform() !== 'win32' && (info.mode & 0o111) === 0) {
		throw new Error(`Staged Otto v${targetVersion} binary is not executable`);
	}
	return path;
}
