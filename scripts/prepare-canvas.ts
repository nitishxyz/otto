#!/usr/bin/env bun
import { $ } from 'bun';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

type PlatformKey =
	| 'darwin-arm64'
	| 'darwin-x64'
	| 'linux-arm64'
	| 'linux-x64'
	| 'windows-x64';

const ROOT = join(import.meta.dir, '..');
const CLI_DIR = join(ROOT, 'apps/cli');
const CANVAS_DIR = join(ROOT, 'apps/canvas');
const CANVAS_TAURI_RESOURCES_DIR = join(CANVAS_DIR, 'src-tauri/resources');
const CANVAS_BINARIES_DIR = join(CANVAS_TAURI_RESOURCES_DIR, 'binaries');
const CANVAS_GHOSTTY_DIR = join(CANVAS_TAURI_RESOURCES_DIR, 'ghostty');
const CANVAS_GHOSTTY_LIB_DIR = join(CANVAS_GHOSTTY_DIR, 'lib');

const PLATFORM_TARGETS: Record<
	PlatformKey,
	{
		bunTarget: string;
		cargoTarget: string;
		binaryName: string;
		isMac: boolean;
		isWindows: boolean;
	}
> = {
	'darwin-arm64': {
		bunTarget: 'bun-darwin-arm64',
		cargoTarget: 'aarch64-apple-darwin',
		binaryName: 'otto-darwin-arm64',
		isMac: true,
		isWindows: false,
	},
	'darwin-x64': {
		bunTarget: 'bun-darwin-x64',
		cargoTarget: 'x86_64-apple-darwin',
		binaryName: 'otto-darwin-x64',
		isMac: true,
		isWindows: false,
	},
	'linux-arm64': {
		bunTarget: 'bun-linux-arm64',
		cargoTarget: 'aarch64-unknown-linux-gnu',
		binaryName: 'otto-linux-arm64',
		isMac: false,
		isWindows: false,
	},
	'linux-x64': {
		bunTarget: 'bun-linux-x64',
		cargoTarget: 'x86_64-unknown-linux-gnu',
		binaryName: 'otto-linux-x64',
		isMac: false,
		isWindows: false,
	},
	'windows-x64': {
		bunTarget: 'bun-windows-x64',
		cargoTarget: 'x86_64-pc-windows-msvc',
		binaryName: 'otto-windows-x64.exe',
		isMac: false,
		isWindows: true,
	},
};

const TARGET_TO_PLATFORM: Record<string, PlatformKey> = Object.fromEntries(
	Object.entries(PLATFORM_TARGETS).map(([platform, config]) => [
		config.cargoTarget,
		platform as PlatformKey,
	]),
) as Record<string, PlatformKey>;

function parseArgs() {
	const args = process.argv.slice(2);
	let platformArg: string | undefined;
	let targetArg: string | undefined;
	let ghosttySourceArg: string | undefined;
	let optimize =
		process.env.OTTO_CANVAS_LIBGHOSTTY_VT_OPTIMIZE ?? 'ReleaseFast';
	let skipCli = false;
	let skipGhostty = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--platform') {
			platformArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--target') {
			targetArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--ghostty-source') {
			ghosttySourceArg = args[index + 1];
			index += 1;
			continue;
		}
		if (arg === '--optimize') {
			optimize = args[index + 1] ?? optimize;
			index += 1;
			continue;
		}
		if (arg === '--skip-cli') {
			skipCli = true;
			continue;
		}
		if (arg === '--skip-ghostty') {
			skipGhostty = true;
		}
	}

	return {
		ghosttySourceArg,
		optimize,
		platformArg,
		skipCli,
		skipGhostty,
		targetArg,
	};
}

function detectHostPlatform(): PlatformKey {
	if (process.platform === 'darwin' && process.arch === 'arm64') {
		return 'darwin-arm64';
	}
	if (process.platform === 'darwin' && process.arch === 'x64') {
		return 'darwin-x64';
	}
	if (process.platform === 'linux' && process.arch === 'arm64') {
		return 'linux-arm64';
	}
	if (process.platform === 'linux' && process.arch === 'x64') {
		return 'linux-x64';
	}
	if (process.platform === 'win32' && process.arch === 'x64') {
		return 'windows-x64';
	}

	throw new Error(
		`Unsupported host platform: ${process.platform}-${process.arch}`,
	);
}

function resolvePlatform(
	platformArg?: string,
	targetArg?: string,
): PlatformKey {
	if (platformArg) {
		if (platformArg in PLATFORM_TARGETS) {
			return platformArg as PlatformKey;
		}
		throw new Error(`Unknown canvas platform: ${platformArg}`);
	}

	if (targetArg) {
		const mapped = TARGET_TO_PLATFORM[targetArg];
		if (mapped) {
			return mapped;
		}
		throw new Error(`Unknown canvas cargo target: ${targetArg}`);
	}

	return detectHostPlatform();
}

function resolveGhosttySourceDir(explicitPath?: string): string {
	const candidates = [
		explicitPath,
		process.env.OTTO_CANVAS_GHOSTTY_SOURCE_DIR,
		join(ROOT, 'vendor/ghostty'),
		join(ROOT, 'tmp/ghostty'),
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		const resolved = resolve(candidate);
		if (
			existsSync(join(resolved, '.git')) ||
			existsSync(join(resolved, 'build.zig'))
		) {
			return resolved;
		}
	}

	throw new Error(
		'Ghostty source was not found. Initialize vendor/ghostty (git submodule update --init --recursive vendor/ghostty) or set OTTO_CANVAS_GHOSTTY_SOURCE_DIR.',
	);
}

async function buildCanvasCli(platform: PlatformKey) {
	const config = PLATFORM_TARGETS[platform];
	const outputPath = join(CLI_DIR, 'dist', config.binaryName);
	const stagedBinaryPath = join(CANVAS_BINARIES_DIR, config.binaryName);
	const commandAliasPath = join(
		CANVAS_BINARIES_DIR,
		config.isWindows ? 'otto.exe' : 'otto',
	);

	console.log(`\n📦 Building embedded canvas CLI for ${platform}...`);
	mkdirSync(CANVAS_BINARIES_DIR, { recursive: true });

	await $`cd ${CLI_DIR} && bun run ../../scripts/build-web.ts`;
	await $`cd ${CLI_DIR} && bun run ../../scripts/prepare-embedded-bins.ts ${platform}`;
	await $`cd ${CLI_DIR} && mkdir -p dist && bun build --compile --minify --define FFF_LIBC='"gnu"' --target=${config.bunTarget} ./index.ts --outfile ${outputPath}`;

	copyFileSync(outputPath, stagedBinaryPath);
	copyFileSync(outputPath, commandAliasPath);
	if (!config.isWindows) {
		await $`chmod +x ${stagedBinaryPath}`;
		await $`chmod +x ${commandAliasPath}`;
	}

	console.log(`   ✅ staged ${stagedBinaryPath}`);
	console.log(`   ✅ staged ${commandAliasPath}`);
}

function ghosttyDylibName(): string {
	if (process.platform === 'darwin') return 'libghostty-vt.dylib';
	if (process.platform === 'linux') return 'libghostty-vt.so';
	if (process.platform === 'win32') return 'ghostty-vt.dll';
	return 'libghostty-vt.dylib';
}

async function stageGhosttyArtifacts(sourceDir: string, optimize: string) {
	if (process.platform !== 'darwin') {
		console.log('\nℹ️  Skipping libghostty-vt staging on non-macOS host.');
		return;
	}

	const commit = (await $`git -C ${sourceDir} rev-parse HEAD`.text()).trim();
	console.log(`\n👻 Building Ghostty from ${sourceDir}`);
	console.log(`   optimize=${optimize}`);
	console.log(`   HEAD=${commit}`);

	await $`cd ${sourceDir} && zig build -Demit-lib-vt -Doptimize=${optimize}`;

	const dylibName = ghosttyDylibName();
	const sourceLib = join(sourceDir, 'zig-out', 'lib', dylibName);
	const stagedLib = join(CANVAS_GHOSTTY_LIB_DIR, dylibName);

	if (!existsSync(sourceLib)) {
		throw new Error(`Expected libghostty-vt at ${sourceLib}`);
	}

	rmSync(CANVAS_GHOSTTY_DIR, { force: true, recursive: true });
	mkdirSync(CANVAS_GHOSTTY_LIB_DIR, { recursive: true });
	copyFileSync(sourceLib, stagedLib);
	writeFileSync(join(CANVAS_GHOSTTY_DIR, 'ghostty-commit.txt'), `${commit}\n`);

	console.log(`   ✅ staged ${stagedLib}`);
}

async function main() {
	const {
		ghosttySourceArg,
		optimize,
		platformArg,
		skipCli,
		skipGhostty,
		targetArg,
	} = parseArgs();
	const platform = resolvePlatform(platformArg, targetArg);

	console.log('🎨 Preparing Otto Canvas build assets');
	console.log(`   platform=${platform}`);

	if (!skipCli) {
		await buildCanvasCli(platform);
	}

	if (!skipGhostty) {
		const config = PLATFORM_TARGETS[platform];
		if (config.isMac) {
			const ghosttySourceDir = resolveGhosttySourceDir(ghosttySourceArg);
			await stageGhosttyArtifacts(ghosttySourceDir, optimize);
		} else {
			console.log('\nℹ️  Skipping Ghostty vendoring for non-macOS target.');
		}
	}

	console.log('\n✅ Canvas assets are ready.');
	console.log(`   CLI dir: ${CANVAS_BINARIES_DIR}`);
	console.log(`   Ghostty dir: ${CANVAS_GHOSTTY_DIR}`);
}

await main();
