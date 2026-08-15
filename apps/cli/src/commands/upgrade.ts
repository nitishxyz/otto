import type { Command } from 'commander';
import { confirm, isCancel } from '@clack/prompts';
import { createWriteStream, chmodSync, mkdirSync, renameSync } from 'node:fs';
import { get } from 'node:https';
import { homedir, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { colors } from '../ui.ts';
import type { DaemonVersionMismatchError } from '../daemon.ts';

const GITHUB_REPO = 'nitishxyz/otto';
const BIN_NAME = 'otto';

async function fetchLatestVersion(): Promise<string | null> {
	try {
		const res = await fetch(
			`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`,
		);
		if (!res.ok) return null;
		const releases = (await res.json()) as {
			tag_name?: string;
			assets?: { name: string }[];
			draft?: boolean;
			prerelease?: boolean;
		}[];

		const cliReleases = releases.filter((r) => {
			if (r.draft || r.prerelease) return false;
			if (!r.tag_name?.match(/^v\d/)) return false;
			return r.assets?.some((a) => a.name.startsWith('otto-'));
		});

		if (cliReleases.length === 0) return null;

		cliReleases.sort((a, b) => {
			const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
			const va = parse(a.tag_name ?? '0.0.0');
			const vb = parse(b.tag_name ?? '0.0.0');
			for (let i = 0; i < Math.max(va.length, vb.length); i++) {
				const diff = (vb[i] ?? 0) - (va[i] ?? 0);
				if (diff !== 0) return diff;
			}
			return 0;
		});

		return cliReleases[0]?.tag_name?.replace(/^v/, '') ?? null;
	} catch {
		return null;
	}
}

function compareVersions(current: string, latest: string): number {
	const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
	const [c, l] = [parse(current), parse(latest)];
	for (let i = 0; i < Math.max(c.length, l.length); i++) {
		const diff = (l[i] ?? 0) - (c[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function getPlatformAsset(): string {
	const platformMap: Record<string, string> = {
		darwin: 'darwin',
		linux: 'linux',
		win32: 'windows',
	};
	const archMap: Record<string, string> = {
		x64: 'x64',
		arm64: 'arm64',
	};
	const os = platformMap[platform()];
	const architecture = archMap[arch()];
	const ext = platform() === 'win32' ? '.exe' : '';

	if (!os || !architecture) {
		throw new Error(`Unsupported platform: ${platform()}-${arch()}`);
	}

	return `${BIN_NAME}-${os}-${architecture}${ext}`;
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

export async function upgradeOttoToVersion(version: string): Promise<void> {
	const asset = getPlatformAsset();
	const url = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${asset}`;
	const ext = platform() === 'win32' ? '.exe' : '';
	const userBin = resolve(homedir(), '.local', 'bin');
	const binPath = resolve(userBin, `${BIN_NAME}${ext}`);
	const tmpPath = resolve(userBin, `.${BIN_NAME}-upgrade-${Date.now()}${ext}`);
	mkdirSync(userBin, { recursive: true });

	console.log(
		`\n  Downloading ${colors.bold(`v${version}`)} for ${platform()}/${arch()}\n`,
	);

	await downloadBinary(url, tmpPath);

	if (platform() !== 'win32') {
		chmodSync(tmpPath, 0o755);
	}

	renameSync(tmpPath, binPath);

	console.log(`\n  ${colors.green('✓')} Downloaded to ${colors.dim(binPath)}`);
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

export function registerUpgradeCommand(program: Command, version: string) {
	program
		.command('upgrade')
		.description('Check for updates and upgrade otto')
		.option('-c, --check', 'Only check for updates, do not install')
		.action(async (opts) => {
			console.log(`Current version: ${version}`);

			const latest = await fetchLatestVersion();
			if (!latest) {
				console.log('Could not fetch latest version');
				process.exit(1);
			}

			console.log(`Latest version:  ${latest}`);

			const cmp = compareVersions(version, latest);
			if (cmp <= 0) {
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
		});
}
