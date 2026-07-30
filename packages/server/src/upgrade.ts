import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { getOttoHomeDir } from '@ottocode/sdk';

const GITHUB_REPO = 'nitishxyz/otto';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** Compares strict release versions without accepting tags or arbitrary URLs. */
export function compareReleaseVersions(
	current: string,
	target: string,
): number {
	if (!VERSION_PATTERN.test(current) || !VERSION_PATTERN.test(target)) {
		throw new Error('Versions must use numeric major.minor.patch format');
	}
	const left = current.split('.').map(Number);
	const right = target.split('.').map(Number);
	for (let index = 0; index < 3; index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

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
	return join(getOttoHomeDir(), 'upgrades', target, releaseAsset());
}

function releaseAsset(): string {
	const platformMap: Partial<Record<NodeJS.Platform, string>> = {
		darwin: 'darwin',
		linux: 'linux',
		win32: 'windows',
	};
	const archMap: Partial<Record<NodeJS.Architecture, string>> = {
		x64: 'x64',
		arm64: 'arm64',
	};
	const operatingSystem = platformMap[platform()];
	const architecture = archMap[arch()];
	if (!operatingSystem || !architecture) {
		throw new Error(`Unsupported upgrade platform: ${platform()}-${arch()}`);
	}
	return `otto-${operatingSystem}-${architecture}${platform() === 'win32' ? '.exe' : ''}`;
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
	const asset = releaseAsset();
	const destination = stagedUpgradePath(target);
	const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
	await mkdir(dirname(destination), { recursive: true });
	const response = await fetcher(
		`https://github.com/${GITHUB_REPO}/releases/download/v${target}/${asset}`,
		{ redirect: 'follow', signal: AbortSignal.timeout(60_000) },
	);
	if (!response.ok || !response.body) {
		throw new Error(
			`Official release download failed (HTTP ${response.status})`,
		);
	}
	try {
		await Bun.write(temporary, response);
		if (platform() !== 'win32') await chmod(temporary, 0o755);
		await rename(temporary, destination);
	} catch (error) {
		await rm(temporary, { force: true }).catch(() => {});
		throw new Error(
			`Unable to stage upgrade; check daemon install permissions: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return {
		status: 'staged',
		targetVersion: target,
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
	const path = stagedUpgradePath(target);
	const info = await stat(path).catch(() => null);
	if (!info?.isFile()) {
		throw new Error(`Otto v${target} is not staged on this machine`);
	}
	if (platform() !== 'win32' && (info.mode & 0o111) === 0) {
		throw new Error(`Staged Otto v${target} binary is not executable`);
	}
	return path;
}
