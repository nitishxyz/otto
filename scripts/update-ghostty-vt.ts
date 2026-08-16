import { rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import pinnedMetadata from '../packages/web-sdk/src/assets/ghostty/ghostty-vt.json';

const REPOSITORY = 'ghostty-org/ghostty';
const ASSET_NAME = 'ghostty-vt.wasm';
const METADATA_PATH = resolve(
	import.meta.dir,
	'../packages/web-sdk/src/assets/ghostty/ghostty-vt.json',
);
const OUTPUT_PATH = resolve(
	import.meta.dir,
	'../packages/web-sdk/src/assets/ghostty/ghostty-vt.wasm',
);

export interface GhosttyVtMetadata {
	repository: string;
	ref: string;
	upstreamCommit: string;
	sourceUrl: string;
	retrieved: string;
	size: number;
	sha256: string;
}

export interface UpdateOptions {
	ref: string;
	expectedSha256?: string;
	expectedCommit?: string;
	inspect: boolean;
	help: boolean;
}

interface GitHubRelease {
	tag_name: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
		size: number;
	}>;
}

interface GitHubCommit {
	sha: string;
}

const HELP = `Update the vendored official Ghostty VT WebAssembly asset.

Usage:
  bun run ghostty-vt:update [options]

Options:
  --ref <tag>              GitHub release tag/ref (default: pinned ref)
  --sha256 <digest>        Required digest for a changed ref or artifact
  --commit <sha>           Optionally require the resolved upstream commit
  --inspect                Download and print provenance without changing files
  -h, --help               Show this help

Safe update workflow:
  bun run ghostty-vt:update --ref <tag> --inspect
  bun run ghostty-vt:update --ref <tag> --sha256 <digest> --commit <sha>

With no options, the command verifies and refreshes only the currently pinned
artifact. A mutable release such as "tip" must be inspected before accepting a
new digest. Set GITHUB_TOKEN if GitHub API rate limits are a concern.`;

function readOptionValue(args: string[], index: number, name: string): string {
	const value = args[index + 1];
	if (!value || value.startsWith('-')) {
		throw new Error(`${name} requires a value`);
	}
	return value;
}

export function parseUpdateOptions(args: string[]): UpdateOptions {
	const options: UpdateOptions = {
		ref: pinnedMetadata.ref,
		inspect: false,
		help: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case '--ref':
				options.ref = readOptionValue(args, index, '--ref');
				index += 1;
				break;
			case '--sha256':
				options.expectedSha256 = readOptionValue(args, index, '--sha256');
				index += 1;
				break;
			case '--commit':
				options.expectedCommit = readOptionValue(args, index, '--commit');
				index += 1;
				break;
			case '--inspect':
				options.inspect = true;
				break;
			case '-h':
			case '--help':
				options.help = true;
				break;
			default:
				throw new Error(`Unknown option: ${argument}`);
		}
	}

	if (!options.ref.trim()) throw new Error('--ref cannot be empty');
	if (
		options.expectedSha256 &&
		!options.expectedSha256.match(/^[a-f0-9]{64}$/i)
	) {
		throw new Error('--sha256 must be a 64-character hexadecimal digest');
	}
	if (
		options.expectedCommit &&
		!options.expectedCommit.match(/^[a-f0-9]{40}$/i)
	) {
		throw new Error('--commit must be a 40-character hexadecimal commit SHA');
	}
	return options;
}

export function sha256(bytes: ArrayBuffer | Uint8Array): string {
	return new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
}

export function createGhosttyVtMetadata(input: {
	ref: string;
	upstreamCommit: string;
	sourceUrl: string;
	retrieved: string;
	size: number;
	sha256: string;
}): GhosttyVtMetadata {
	return { repository: REPOSITORY, ...input };
}

function githubHeaders(): HeadersInit {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'otto-ghostty-vt-updater',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (process.env.GITHUB_TOKEN) {
		headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	}
	return headers;
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: githubHeaders() });
	if (!response.ok) {
		throw new Error(`GitHub request failed (${response.status}): ${url}`);
	}
	return (await response.json()) as T;
}

async function atomicWrite(
	path: string,
	data: Bun.BlobOrStringOrBuffer,
): Promise<void> {
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await Bun.write(temporaryPath, data);
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}

function unchangedRetrievalDate(
	metadata: GhosttyVtMetadata,
	current: GhosttyVtMetadata,
): string {
	return metadata.ref === current.ref &&
		metadata.upstreamCommit === current.upstreamCommit &&
		metadata.sourceUrl === current.sourceUrl &&
		metadata.size === current.size &&
		metadata.sha256 === current.sha256
		? current.retrieved
		: metadata.retrieved;
}

export async function updateGhosttyVt(options: UpdateOptions): Promise<void> {
	const current = pinnedMetadata as GhosttyVtMetadata;
	const expectedSha256 =
		options.expectedSha256 ??
		(options.ref === current.ref ? current.sha256 : undefined);
	if (!options.inspect && !expectedSha256) {
		throw new Error(
			'Ref differs from the pin; run --inspect, then pass the reported --sha256',
		);
	}

	const releaseUrl = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${encodeURIComponent(options.ref)}`;
	const release = await fetchJson<GitHubRelease>(releaseUrl);
	const asset = release.assets.find(
		(candidate) => candidate.name === ASSET_NAME,
	);
	if (!asset) {
		throw new Error(`Release ${options.ref} does not contain ${ASSET_NAME}`);
	}
	const commit = await fetchJson<GitHubCommit>(
		`https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(release.tag_name)}`,
	);
	if (
		options.expectedCommit &&
		commit.sha.toLowerCase() !== options.expectedCommit.toLowerCase()
	) {
		throw new Error(
			`Upstream commit mismatch: expected ${options.expectedCommit}, resolved ${commit.sha}`,
		);
	}

	const response = await fetch(asset.browser_download_url);
	if (!response.ok) {
		throw new Error(
			`Asset download failed (${response.status}): ${asset.browser_download_url}`,
		);
	}
	const bytes = await response.arrayBuffer();
	if (bytes.byteLength !== asset.size) {
		throw new Error(
			`Asset size mismatch: release reports ${asset.size}, downloaded ${bytes.byteLength}`,
		);
	}
	const digest = sha256(bytes);
	const next = createGhosttyVtMetadata({
		ref: release.tag_name,
		upstreamCommit: commit.sha,
		sourceUrl: asset.browser_download_url,
		retrieved: new Date().toISOString().slice(0, 10),
		size: bytes.byteLength,
		sha256: digest,
	});

	if (options.inspect) {
		console.log(JSON.stringify(next, null, 2));
		console.log(
			`\nVerify upstream changes, then run with --sha256 ${digest} --commit ${commit.sha}`,
		);
		return;
	}
	if (digest.toLowerCase() !== expectedSha256?.toLowerCase()) {
		throw new Error(
			`Asset digest mismatch: expected ${expectedSha256}, downloaded ${digest}`,
		);
	}

	next.retrieved = unchangedRetrievalDate(next, current);
	const serializedMetadata = `${JSON.stringify(next, null, '\t')}\n`;
	await atomicWrite(OUTPUT_PATH, bytes);
	await atomicWrite(METADATA_PATH, serializedMetadata);
	console.log(
		`Updated ${OUTPUT_PATH} (${next.size} bytes, sha256 ${next.sha256}, commit ${next.upstreamCommit})`,
	);
}

if (import.meta.main) {
	try {
		const options = parseUpdateOptions(Bun.argv.slice(2));
		if (options.help) console.log(HELP);
		else await updateGhosttyVt(options);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
