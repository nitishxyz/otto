export const OTTO_RELEASE_REPOSITORY = 'nitishxyz/otto';

export interface ReleaseVersion {
	major: number;
	minor: number;
	patch: number;
	/** Canonical version without the release tag prefix. */
	version: string;
	/** Canonical GitHub release tag. */
	tag: string;
}

export type ReleasePlatform = 'darwin' | 'linux' | 'win32';
export type ReleaseArchitecture = 'x64' | 'arm64';

const RELEASE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_PLATFORMS: Record<ReleasePlatform, string> = {
	darwin: 'darwin',
	linux: 'linux',
	win32: 'windows',
};

/** Parses a stable numeric release version, accepting either `1.2.3` or `v1.2.3`. */
export function parseReleaseVersion(input: string): ReleaseVersion {
	const match = RELEASE_VERSION_PATTERN.exec(input);
	if (!match) {
		throw new Error(
			'Release version must use major.minor.patch format, optionally prefixed with v',
		);
	}
	const [major, minor, patch] = match.slice(1).map(Number) as [
		number,
		number,
		number,
	];
	if (![major, minor, patch].every(Number.isSafeInteger)) {
		throw new Error('Release version components must be safe integers');
	}
	const version = `${major}.${minor}.${patch}`;
	return { major, minor, patch, version, tag: `v${version}` };
}

/** Compares release versions, returning a negative value when `left` is older. */
export function compareReleaseVersions(left: string, right: string): number {
	const leftVersion = parseReleaseVersion(left);
	const rightVersion = parseReleaseVersion(right);
	for (const component of ['major', 'minor', 'patch'] as const) {
		const difference = leftVersion[component] - rightVersion[component];
		if (difference !== 0) return difference;
	}
	return 0;
}

/** Returns the official binary asset name for a supported release target. */
export function getReleaseAssetName(
	platform: string,
	architecture: string,
): string {
	if (!Object.hasOwn(RELEASE_PLATFORMS, platform)) {
		throw new Error(
			`Unsupported release platform: ${platform}-${architecture}`,
		);
	}
	if (architecture !== 'x64' && architecture !== 'arm64') {
		throw new Error(
			`Unsupported release platform: ${platform}-${architecture}`,
		);
	}
	const os = RELEASE_PLATFORMS[platform as ReleasePlatform];
	const extension = platform === 'win32' ? '.exe' : '';
	return `otto-${os}-${architecture}${extension}`;
}

/** Constructs the immutable official GitHub URL for a release binary. */
export function getOfficialReleaseUrl(
	version: string,
	platform: string,
	architecture: string,
): string {
	const release = parseReleaseVersion(version);
	const asset = getReleaseAssetName(platform, architecture);
	return `https://github.com/${OTTO_RELEASE_REPOSITORY}/releases/download/${release.tag}/${asset}`;
}
