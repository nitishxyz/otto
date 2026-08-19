import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	chmodSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { embeddedWhisperCli } from './generated/embedded-whisper-cli.ts';

function getAgiBinDir(): string {
	const cfgHome = process.env.XDG_CONFIG_HOME;
	const home = process.env.HOME || process.env.USERPROFILE || '';
	const configBase = cfgHome?.trim() || join(home, '.config');
	return join(configBase, 'otto', 'bin');
}

const MIN_BINARY_SIZE = 100_000;
const WHISPER_BINARY_REVISION = 'whisper.cpp-v1.8.5-portable-1';

export function bootstrapBinaries(): void {
	const binDir = getAgiBinDir();
	const whisperCliName =
		process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';

	bootstrapBinary(embeddedWhisperCli, join(binDir, whisperCliName), {
		revision: WHISPER_BINARY_REVISION,
	});
}

export function bootstrapBinary(
	embeddedPath: string | null,
	dest: string,
	options: { overwrite?: boolean; revision?: string } = {},
): void {
	if (!embeddedPath) return;

	const revisionPath = `${dest}.revision`;
	if (!options.overwrite && existsSync(dest)) {
		if (!options.revision) return;
		try {
			if (readFileSync(revisionPath, 'utf8').trim() === options.revision) {
				return;
			}
		} catch {}
	}

	let buf: Buffer;
	try {
		buf = readFileSync(embeddedPath);
		if (buf.length < MIN_BINARY_SIZE) return;
	} catch {
		return;
	}

	try {
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, buf);
		if (process.platform !== 'win32') {
			chmodSync(dest, 0o755);
		}
		if (options.revision) {
			writeFileSync(revisionPath, `${options.revision}\n`);
		}
	} catch {}
}
