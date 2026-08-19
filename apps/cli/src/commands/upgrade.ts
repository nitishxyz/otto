import { confirm, isCancel } from '@clack/prompts';
import {
	compareReleaseVersions,
	getOfficialReleaseUrl,
	OTTO_RELEASE_REPOSITORY,
	parseReleaseVersion,
} from '@ottocode/sdk/release';
import { createWriteStream, chmodSync, mkdirSync, renameSync } from 'node:fs';
import { get } from 'node:https';
import { homedir, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { colors } from '../ui.ts';
import type { DaemonVersionMismatchError } from '../daemon.ts';

const BIN_NAME = 'otto';

async function fetchLatestVersion(): Promise<string | null> {
	try {
		const res = await fetch(
			`https://api.github.com/repos/${OTTO_RELEASE_REPOSITORY}/releases?per_page=20`,
		);
		if (!res.ok) return null;
		const releases = (await res.json()) as {
			tag_name?: string;
			assets?: { name: string }[];
			draft?: boolean;
			prerelease?: boolean;
		}[];

		const cliReleases = releases.filter((release) => {
			if (release.draft || release.prerelease || !release.tag_name)
				return false;
			try {
				if (parseReleaseVersion(release.tag_name).tag !== release.tag_name)
					return false;
			} catch {
				return false;
			}
			return release.assets?.some((asset) => asset.name.startsWith('otto-'));
		});

		if (cliReleases.length === 0) return null;

		cliReleases.sort((a, b) =>
			compareReleaseVersions(b.tag_name ?? '0.0.0', a.tag_name ?? '0.0.0'),
		);

		const latest = cliReleases[0]?.tag_name;
		return latest ? parseReleaseVersion(latest).version : null;
	} catch {
		return null;
	}
}

function renderProgressBar(percent: number, width = 30): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	const bar = `${colors.green('█'.repeat(filled))}${colors.dim('░'.repeat(empty))}`;
	return `  ${bar} ${percent.toFixed(0).padStart(3)}%`;
}

function downloadBinary(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = createWriteStream(dest);
		let totalBytes = 0;
		let downloadedBytes = 0;

		function follow(response: import('node:http').IncomingMessage) {
			if (
				response.statusCode &&
				response.statusCode >= 300 &&
				response.statusCode < 400 &&
				response.headers.location
			) {
				get(response.headers.location, follow).on('error', reject);
				return;
			}

			if (response.statusCode !== 200) {
				reject(new Error(`Download failed with status ${response.statusCode}`));
				return;
			}

			totalBytes = Number.parseInt(
				response.headers['content-length'] || '0',
				10,
			);

			response.on('data', (chunk: Buffer) => {
				downloadedBytes += chunk.length;
				if (totalBytes > 0) {
					const percent = (downloadedBytes / totalBytes) * 100;
					const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
					const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
					process.stdout.write(
						`\r${renderProgressBar(percent)}  ${colors.dim(`${downloadedMB}/${totalMB} MB`)}`,
					);
				} else {
					const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
					process.stdout.write(
						`\r  Downloading... ${colors.dim(`${downloadedMB} MB`)}`,
					);
				}
			});

			response.pipe(file);
			file.on('finish', () => {
				file.close();
				process.stdout.write('\n');
				resolve();
			});
		}

		get(url, follow).on('error', (err) => {
			file.close();
			reject(err);
		});
	});
}

export interface UpgradeOttoOptions {
	platform?: string;
	architecture?: string;
	homeDirectory?: string;
	now?: () => number;
	download?: (url: string, destination: string) => Promise<void>;
	makeDirectory?: typeof mkdirSync;
	makeExecutable?: typeof chmodSync;
	install?: typeof renameSync;
	print?: (message: string) => void;
}

export async function upgradeOttoToVersion(
	version: string,
	options: UpgradeOttoOptions = {},
): Promise<void> {
	const targetPlatform = options.platform ?? platform();
	const targetArchitecture = options.architecture ?? arch();
	const release = parseReleaseVersion(version);
	const url = getOfficialReleaseUrl(
		release.version,
		targetPlatform,
		targetArchitecture,
	);
	const ext = targetPlatform === 'win32' ? '.exe' : '';
	const userBin = resolve(options.homeDirectory ?? homedir(), '.local', 'bin');
	const binPath = resolve(userBin, `${BIN_NAME}${ext}`);
	const tmpPath = resolve(
		userBin,
		`.${BIN_NAME}-upgrade-${(options.now ?? Date.now)()}${ext}`,
	);
	(options.makeDirectory ?? mkdirSync)(userBin, { recursive: true });
	const print = options.print ?? console.log;

	print(
		`\n  Downloading ${colors.bold(release.tag)} for ${targetPlatform}/${targetArchitecture}\n`,
	);

	await (options.download ?? downloadBinary)(url, tmpPath);

	if (targetPlatform !== 'win32') {
		(options.makeExecutable ?? chmodSync)(tmpPath, 0o755);
	}

	(options.install ?? renameSync)(tmpPath, binPath);

	print(`\n  ${colors.green('✓')} Downloaded to ${colors.dim(binPath)}`);
}

interface DaemonMismatchUpgradeOptions {
	interactive?: boolean;
	confirmUpgrade?: () => Promise<boolean>;
	upgrade?: (version: string) => Promise<void>;
	print?: (message: string) => void;
}

export async function offerDaemonMismatchUpgrade(
	error: DaemonVersionMismatchError,
	options: DaemonMismatchUpgradeOptions = {},
): Promise<boolean> {
	const print = options.print ?? console.error;
	print(
		`Daemon version mismatch: daemon v${error.daemonVersion}, CLI v${error.cliVersion}.`,
	);

	const interactive =
		options.interactive ??
		(process.stdin.isTTY === true &&
			process.stdout.isTTY === true &&
			!process.env.CI &&
			process.env.OTTO_CI_MODE !== '1');
	if (!interactive) {
		print(`Run 'otto upgrade' to upgrade the CLI before continuing.`);
		return false;
	}

	const confirmUpgrade =
		options.confirmUpgrade ??
		(async () => {
			const result = await confirm({
				message: `Upgrade the CLI to v${error.daemonVersion} now?`,
				initialValue: true,
			});
			return !isCancel(result) && result;
		});
	if (!(await confirmUpgrade())) {
		print(`Upgrade cancelled. The newer daemon was left running.`);
		return false;
	}

	await (options.upgrade ?? upgradeOttoToVersion)(error.daemonVersion);
	return true;
}

export { registerUpgradeCommand } from './lazy/upgrade.ts';

export async function handleUpgrade(
	opts: { check?: boolean },
	version: string,
) {
	console.log(`Current version: ${version}`);

	const latest = await fetchLatestVersion();
	if (!latest) {
		console.log('Could not fetch latest version');
		process.exit(1);
	}

	console.log(`Latest version:  ${latest}`);

	const cmp = compareReleaseVersions(version, latest);
	if (cmp >= 0) {
		console.log('\n✓ You are on the latest version');
		return;
	}

	console.log(`\nUpdate available: ${version} → ${latest}`);

	if (opts.check) {
		console.log(`\nRun 'otto upgrade' to install`);
		return;
	}

	await upgradeOttoToVersion(latest);

	console.log(`  ${colors.green('✓')} Upgrade complete!`);
	console.log(`  Run ${colors.bold('otto')} to use the new version.`);
	process.exit(0);
}
