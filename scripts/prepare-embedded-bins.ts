#!/usr/bin/env bun
import { $ } from 'bun';
import {
	copyFileSync,
	existsSync,
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const CLI_DIR = join(ROOT, 'apps', 'cli');
const VENDOR_BIN = join(ROOT, 'vendor', 'bin');
const CLI_VENDOR = join(CLI_DIR, 'vendor');
const GENERATED_DIR = join(CLI_DIR, 'src', 'generated');

function getPlatformKey(target?: string): string {
	if (target) {
		const map: Record<string, string> = {
			'bun-darwin-arm64': 'darwin-arm64',
			'bun-darwin-x64': 'darwin-x64',
			'bun-linux-x64': 'linux-x64',
			'bun-linux-arm64': 'linux-arm64',
			'bun-windows-x64': 'windows-x64',
			'darwin-arm64': 'darwin-arm64',
			'darwin-x64': 'darwin-x64',
			'linux-x64': 'linux-x64',
			'linux-arm64': 'linux-arm64',
			'windows-x64': 'windows-x64',
			'aarch64-apple-darwin': 'darwin-arm64',
			'x86_64-apple-darwin': 'darwin-x64',
			'x86_64-unknown-linux-gnu': 'linux-x64',
			'x86_64-unknown-linux-musl': 'linux-x64',
			'aarch64-unknown-linux-gnu': 'linux-arm64',
			'x86_64-pc-windows-msvc': 'windows-x64',
		};
		if (map[target]) return map[target];
	}
	const platform = process.platform;
	const arch = process.arch;
	const os =
		platform === 'darwin'
			? 'darwin'
			: platform === 'win32'
				? 'windows'
				: 'linux';
	const cpu = arch === 'arm64' ? 'arm64' : 'x64';
	return `${os}-${cpu}`;
}

const scriptArgs = process.argv.slice(2);
const requireWhisperCli =
	process.env.OTTO_REQUIRE_EMBEDDED_WHISPER === '1' ||
	scriptArgs.includes('--require-whisper');
const targetArg = scriptArgs.find((arg) => !arg.startsWith('--'));
const platformKey = getPlatformKey(targetArg);
const isWindows = platformKey.startsWith('windows');
const whisperCliName = isWindows ? 'whisper-cli.exe' : 'whisper-cli';
const serveSimName = isWindows ? 'serve-sim.exe' : 'serve-sim';

const whisperCliSource = join(VENDOR_BIN, platformKey, whisperCliName);
const whisperCliDest = join(CLI_VENDOR, whisperCliName);
const serveSimDest = join(CLI_VENDOR, serveSimName);

mkdirSync(CLI_VENDOR, { recursive: true });
mkdirSync(GENERATED_DIR, { recursive: true });

function getFffBinPackage(platform: string): {
	packageName: string;
	libName: string;
} {
	const map: Record<string, { packageName: string; libName: string }> = {
		'darwin-arm64': {
			packageName: '@ff-labs/fff-bin-darwin-arm64',
			libName: 'libfff_c.dylib',
		},
		'darwin-x64': {
			packageName: '@ff-labs/fff-bin-darwin-x64',
			libName: 'libfff_c.dylib',
		},
		'linux-x64': {
			packageName: '@ff-labs/fff-bin-linux-x64-gnu',
			libName: 'libfff_c.so',
		},
		'linux-arm64': {
			packageName: '@ff-labs/fff-bin-linux-arm64-gnu',
			libName: 'libfff_c.so',
		},
		'windows-x64': {
			packageName: '@ff-labs/fff-bin-win32-x64',
			libName: 'fff_c.dll',
		},
	};
	const entry = map[platform];
	if (!entry) throw new Error(`Unsupported FFF platform: ${platform}`);
	return entry;
}

function getFffVersion(): string {
	const pkgPath = join(
		ROOT,
		'node_modules',
		'@ff-labs',
		'fff-bun',
		'package.json',
	);
	const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
		version: string;
	};
	return pkg.version;
}

/**
 * Ensure the platform-specific @ff-labs/fff-bin-* package exists in
 * node_modules so `bun build --compile` can embed the native library.
 * `bun install` only installs the optional dependency matching the host,
 * so cross-compiles (e.g. windows-x64 from macOS) need a manual fetch.
 */
async function ensureFffBinPackage(): Promise<void> {
	const { packageName, libName } = getFffBinPackage(platformKey);
	const packageDir = join(ROOT, 'node_modules', ...packageName.split('/'));
	const libPath = join(packageDir, libName);
	if (existsSync(libPath)) {
		console.log(`FFF native library present: ${packageName}/${libName}`);
		return;
	}

	const version = getFffVersion();
	console.log(`Downloading ${packageName}@${version} for ${platformKey}...`);
	const tmp = mkdtempSync(join(tmpdir(), 'otto-fff-bin-'));
	try {
		const metaResponse = await fetch(
			`https://registry.npmjs.org/${packageName}/${version}`,
		);
		if (!metaResponse.ok)
			throw new Error(`npm metadata fetch failed: ${metaResponse.status}`);
		const meta = (await metaResponse.json()) as {
			dist?: { tarball?: string };
		};
		if (!meta.dist?.tarball)
			throw new Error(`No tarball for ${packageName}@${version}`);
		const tarballResponse = await fetch(meta.dist.tarball);
		if (!tarballResponse.ok)
			throw new Error(`tarball fetch failed: ${tarballResponse.status}`);
		const archivePath = join(tmp, 'fff-bin.tgz');
		await Bun.write(archivePath, await tarballResponse.arrayBuffer());
		await $`tar -xzf ${archivePath} -C ${tmp}`;
		const extracted = join(tmp, 'package');
		mkdirSync(packageDir, { recursive: true });
		for (const entry of readdirSync(extracted)) {
			copyFileSync(join(extracted, entry), join(packageDir, entry));
		}
		if (!existsSync(libPath))
			throw new Error(`Extracted package missing ${libName}`);
		console.log(`Installed ${packageName}@${version} into node_modules`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

function writeVendorAssetDeclaration(fileName: string, exportName: string) {
	writeFileSync(
		join(CLI_VENDOR, `${fileName}.d.ts`),
		`declare const ${exportName}: string;\nexport default ${exportName};\n`,
	);
}

function getHostPlatformKey(): string {
	return getPlatformKey();
}

function getBunCompileTarget(platform: string): string | null {
	const map: Record<string, string> = {
		'darwin-arm64': 'bun-darwin-arm64',
		'darwin-x64': 'bun-darwin-x64',
		'linux-x64': 'bun-linux-x64',
		'linux-arm64': 'bun-linux-arm64',
		'windows-x64': 'bun-windows-x64',
	};
	return map[platform] ?? null;
}

function getServeSimHelperName(entryContent: string): string {
	const match = entryContent.match(/\.\/(serve-sim-bin-[^"]+)/);
	return match?.[1] ?? 'serve-sim-bin-jfcjgebt.';
}

async function prepareEmbeddedServeSim(): Promise<{
	hasServeSim: boolean;
	helperName: string | null;
}> {
	if (!platformKey.startsWith('darwin')) {
		console.log(`serve-sim embedding skipped for ${platformKey} (macOS only)`);
		return { hasServeSim: false, helperName: null };
	}

	const hostPlatformKey = getHostPlatformKey();
	if (platformKey !== hostPlatformKey) {
		console.log(
			`serve-sim embedding skipped for ${platformKey}; host has ${hostPlatformKey} helper binaries`,
		);
		return { hasServeSim: false, helperName: null };
	}

	const compileTarget = getBunCompileTarget(platformKey);
	if (!compileTarget) return { hasServeSim: false, helperName: null };

	const serveSimPackageDir = join(ROOT, 'node_modules', 'serve-sim');
	const serveSimEntry = join(serveSimPackageDir, 'dist', 'serve-sim.js');
	const serveSimHelper = join(serveSimPackageDir, 'bin', 'serve-sim-bin');
	if (!existsSync(serveSimEntry) || !existsSync(serveSimHelper)) {
		console.log(
			'serve-sim package missing from node_modules — embedded serve-sim will be null',
		);
		return { hasServeSim: false, helperName: null };
	}

	const helperName = getServeSimHelperName(readFileSync(serveSimEntry, 'utf8'));
	const helperDest = join(CLI_VENDOR, helperName);
	await $`bun build --compile --target=${compileTarget} ${serveSimEntry} --outfile ${serveSimDest}`;
	copyFileSync(serveSimHelper, helperDest);
	chmodSync(serveSimDest, 0o755);
	chmodSync(helperDest, 0o755);
	writeVendorAssetDeclaration(serveSimName, 'embeddedServeSimPath');
	writeVendorAssetDeclaration(helperName, 'embeddedServeSimHelperPath');
	console.log(`Generated embedded serve-sim for ${platformKey}`);
	return { hasServeSim: true, helperName };
}

await ensureFffBinPackage();

async function ensureVendorWhisperCli() {
	if (existsSync(whisperCliSource)) {
		return true;
	}

	console.log(
		`Vendor whisper-cli missing for ${platformKey}; preparing vendor binaries...`,
	);
	await $`bash ${join(ROOT, 'scripts', 'download-vendor-bins.sh')} ${platformKey}`;
	return existsSync(whisperCliSource);
}

let hasWhisperCli = false;

if (await ensureVendorWhisperCli()) {
	copyFileSync(whisperCliSource, whisperCliDest);
	writeVendorAssetDeclaration(whisperCliName, 'embeddedWhisperCliPath');
	hasWhisperCli = true;
	console.log(`Copied ${platformKey}/${whisperCliName} to apps/cli/vendor/`);
} else {
	console.log(
		`No vendor binary at ${whisperCliSource} — embedded whisper-cli will be null`,
	);
	if (requireWhisperCli) {
		console.error(`Required whisper-cli binary missing for ${platformKey}`);
		process.exit(1);
	}
}

const generatedWhisperFile = join(GENERATED_DIR, 'embedded-whisper-cli.ts');
const generatedServeSimFile = join(GENERATED_DIR, 'embedded-serve-sim.ts');

if (hasWhisperCli) {
	writeFileSync(
		generatedWhisperFile,
		`import embeddedWhisperCliPath from '../../vendor/${whisperCliName}' with { type: 'file' };\nexport const embeddedWhisperCli: string | null = embeddedWhisperCliPath;\n`,
	);
	console.log('Generated embedded-whisper-cli.ts (with binary)');
} else {
	writeFileSync(
		generatedWhisperFile,
		`export const embeddedWhisperCli: string | null = null;\n`,
	);
	console.log('Generated embedded-whisper-cli.ts (null — no binary available)');
}

const serveSim = await prepareEmbeddedServeSim();

if (serveSim.hasServeSim && serveSim.helperName) {
	writeFileSync(
		generatedServeSimFile,
		`import embeddedServeSimPath from '../../vendor/${serveSimName}' with { type: 'file' };\nimport embeddedServeSimHelperPath from '../../vendor/${serveSim.helperName}' with { type: 'file' };\nexport const embeddedServeSim: { executable: string; helper: string; helperName: string } | null = { executable: embeddedServeSimPath, helper: embeddedServeSimHelperPath, helperName: '${serveSim.helperName}' };\n`,
	);
	console.log('Generated embedded-serve-sim.ts (with binary)');
} else {
	writeFileSync(
		generatedServeSimFile,
		`export const embeddedServeSim: { executable: string; helper: string; helperName: string } | null = null;\n`,
	);
	console.log('Generated embedded-serve-sim.ts (null — no binary available)');
}
