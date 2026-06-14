import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	OTTOCODE_CO_AUTHOR,
	appendCoAuthorTrailer,
	injectCoAuthorIntoGitCommit,
	shouldCoAuthorCommits,
} from '@ottocode/sdk';

describe('git commit attribution', () => {
	test('does not append the ottocode co-author by default', () => {
		const message = 'fix: update settings';

		expect(appendCoAuthorTrailer(message)).toBe(message);
	});

	test('appends the ottocode co-author when enabled', () => {
		const message = 'fix: update settings';
		const result = appendCoAuthorTrailer(message, true);

		expect(result).toBe(`${message}\n\n${OTTOCODE_CO_AUTHOR}`);
	});

	test('does not inject into shell git commits by default', () => {
		const command = 'git commit -m "fix: update settings"';

		expect(injectCoAuthorIntoGitCommit(command)).toBe(command);
	});

	test('injects into shell git commits when enabled', () => {
		const command = 'git commit -m "fix: update settings"';
		const result = injectCoAuthorIntoGitCommit(command, true);

		expect(result).toContain(OTTOCODE_CO_AUTHOR);
	});

	test('reads the opt-in setting from global config', async () => {
		const previousConfigHome = process.env.XDG_CONFIG_HOME;
		const configHome = await mkdtemp(join(tmpdir(), 'otto-config-'));
		process.env.XDG_CONFIG_HOME = configHome;
		try {
			await mkdir(join(configHome, 'otto'), { recursive: true });
			await Bun.write(
				join(configHome, 'otto', 'config.json'),
				JSON.stringify({ defaults: { coAuthorCommits: true } }),
			);

			expect(shouldCoAuthorCommits()).toBe(true);
		} finally {
			if (previousConfigHome === undefined) {
				delete process.env.XDG_CONFIG_HOME;
			} else {
				process.env.XDG_CONFIG_HOME = previousConfigHome;
			}
		}
	});
});
