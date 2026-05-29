#!/usr/bin/env bun
import { $ } from 'bun';
import { existsSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
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

const targetArg = process.argv[2];
const platformKey = getPlatformKey(targetArg);
const isWindows = platformKey.startsWith('windows');
const rgName = isWindows ? 'rg.exe' : 'rg';
const whisperCliName = isWindows ? 'whisper-cli.exe' : 'whisper-cli';

const rgSource = join(VENDOR_BIN, platformKey, rgName);
const rgDest = join(CLI_VENDOR, rgName);
const whisperCliSource = join(VENDOR_BIN, platformKey, whisperCliName);
const whisperCliDest = join(CLI_VENDOR, whisperCliName);

mkdirSync(CLI_VENDOR, { recursive: true });
mkdirSync(GENERATED_DIR, { recursive: true });

function writeVendorAssetDeclaration(fileName: string, exportName: string) {
	writeFileSync(
		join(CLI_VENDOR, `${fileName}.d.ts`),
		`declare const ${exportName}: string;\nexport default ${exportName};\n`,
	);
}

async function ensureVendorRipgrep() {
	if (existsSync(rgSource)) {
		return true;
	}

	console.log(
		`Vendor ripgrep missing for ${platformKey}; downloading vendor binaries...`,
	);
	await $`bash ${join(ROOT, 'scripts', 'download-vendor-bins.sh')}`;
	return existsSync(rgSource);
}

async function ensureVendorWhisperCli() {
	if (existsSync(whisperCliSource)) {
		return true;
	}

	console.log(
		`Vendor whisper-cli missing for ${platformKey}; preparing vendor binaries...`,
	);
	await $`bash ${join(ROOT, 'scripts', 'download-vendor-bins.sh')}`;
	return existsSync(whisperCliSource);
}

let hasRg = false;
let hasWhisperCli = false;

if (await ensureVendorRipgrep()) {
	copyFileSync(rgSource, rgDest);
	writeVendorAssetDeclaration(rgName, 'embeddedRgPath');
	hasRg = true;
	console.log(`Copied ${platformKey}/${rgName} to apps/cli/vendor/`);
} else {
	console.log(`No vendor binary at ${rgSource} — embedded rg will be null`);
}

if (await ensureVendorWhisperCli()) {
	copyFileSync(whisperCliSource, whisperCliDest);
	writeVendorAssetDeclaration(whisperCliName, 'embeddedWhisperCliPath');
	hasWhisperCli = true;
	console.log(`Copied ${platformKey}/${whisperCliName} to apps/cli/vendor/`);
} else {
	console.log(
		`No vendor binary at ${whisperCliSource} — embedded whisper-cli will be null`,
	);
}

const generatedFile = join(GENERATED_DIR, 'embedded-rg.ts');
const generatedWhisperFile = join(GENERATED_DIR, 'embedded-whisper-cli.ts');

if (hasRg) {
	writeFileSync(
		generatedFile,
		`import embeddedRgPath from '../../vendor/${rgName}' with { type: 'file' };\nexport const embeddedRg: string | null = embeddedRgPath;\n`,
	);
	console.log('Generated embedded-rg.ts (with binary)');
} else {
	writeFileSync(
		generatedFile,
		`export const embeddedRg: string | null = null;\n`,
	);
	console.log('Generated embedded-rg.ts (null — no binary available)');
}

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
