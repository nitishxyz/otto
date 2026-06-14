import { readFileSync } from 'node:fs';
import { getGlobalConfigPath } from '../../../../config/src/paths.ts';

const OTTOCODE_BOT_USER_ID = '261994719';

export const OTTOCODE_BOT_NAME = 'ottocode-io[bot]';
export const OTTOCODE_BOT_EMAIL = `${OTTOCODE_BOT_USER_ID}+${OTTOCODE_BOT_NAME}@users.noreply.github.com`;
export const OTTOCODE_CO_AUTHOR = `Co-authored-by: ${OTTOCODE_BOT_NAME} <${OTTOCODE_BOT_EMAIL}>`;

type JsonObject = Record<string, unknown>;

function readCoAuthorCommits(filePath: string): boolean | undefined {
	try {
		const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return undefined;
		}
		const defaults = (parsed as JsonObject).defaults;
		if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
			return undefined;
		}
		const value = (defaults as JsonObject).coAuthorCommits;
		return typeof value === 'boolean' ? value : undefined;
	} catch {
		return undefined;
	}
}

export function shouldCoAuthorCommits(_projectRoot?: string): boolean {
	return readCoAuthorCommits(getGlobalConfigPath()) ?? false;
}

export function appendCoAuthorTrailer(
	message: string,
	enabled = false,
): string {
	if (!enabled) return message;
	if (message.includes(OTTOCODE_CO_AUTHOR)) return message;
	return `${message}\n\n${OTTOCODE_CO_AUTHOR}`;
}

const GIT_COMMIT_MSG_RE =
	/git\s+commit\s+(?:[^"']*?)(?:-[a-z]*m|-m)\s+(["'])([\s\S]*?)\1/g;

export function injectCoAuthorIntoGitCommit(
	cmd: string,
	enabled = false,
): string {
	if (!enabled) return cmd;
	return cmd.replace(GIT_COMMIT_MSG_RE, (match, quote, msg) => {
		const patched = appendCoAuthorTrailer(msg, true);
		return match.replace(
			`${quote}${msg}${quote}`,
			`${quote}${patched}${quote}`,
		);
	});
}
