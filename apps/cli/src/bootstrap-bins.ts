import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { embeddedWhisperCli } from './generated/embedded-whisper-cli.ts';

function getAgiBinDir(): string {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

const MIN_BINARY_SIZE = 100_000;

export function bootstrapBinaries(): void {
	const binDir = getAgiBinDir();
	const whisperCliName =
		process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

	bootstrapBinary(embeddedWhisperCli, join(binDir, whisperCliName));
}

function bootstrapBinary(
	embeddedPath: string | null,
	dest: string,
	options: { overwrite?: boolean } = {},
): void {
	if (!embeddedPath || (!options.overwrite && existsSync(dest))) return;

	let buf: Buffer;
	try {
		buf = readFileSync(embeddedPath);
		if (buf.length < MIN_BINARY_SIZE) return;
	} catch {
		return;
	}

	try {
		const binDir = getAgiBinDir();
		mkdirSync(binDir, { recursive: true });
		writeFileSync(dest, buf);
		if (process.platform !== 'win32') {
			chmodSync(dest, 0o755);
		}
	} catch {}
}
