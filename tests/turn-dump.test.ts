import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '@ottocode/sdk';
import { TurnDumpCollector } from '../packages/server/src/runtime/debug/turn-dump.ts';

describe('turn dump collector', () => {
	test('keeps the final non-empty text snapshot', () => {
		const dump = new TurnDumpCollector({
			sessionId: 'session-1',
			messageId: 'message-1',
			provider: 'openai',
			model: 'gpt-5.4',
			agent: 'build',
		});

		dump.recordTextDelta(0, 'Hey');
		dump.recordTextDelta(0, 'Hey! What can I help you with?', { force: true });

		const snapshots = (
			dump as unknown as {
				data: {
					stream: {
						textDeltas: Array<{
							stepIndex: number;
							textSnapshot: string;
						}>;
					};
				};
			}
		).data.stream.textDeltas;

		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]).toMatchObject({
			stepIndex: 0,
			textSnapshot: 'Hey',
		});
		expect(snapshots[1]).toMatchObject({
			stepIndex: 0,
			textSnapshot: 'Hey! What can I help you with?',
		});
	});

	test('skips forced empty snapshots after text has already been captured', () => {
		const dump = new TurnDumpCollector({
			sessionId: 'session-2',
			messageId: 'message-2',
			provider: 'openai',
			model: 'gpt-5.4',
			agent: 'build',
		});

		dump.recordTextDelta(0, 'Hey');
		dump.recordTextDelta(1, '', { force: true });

		const snapshots = (
			dump as unknown as {
				data: {
					stream: {
						textDeltas: Array<{
							stepIndex: number;
							textSnapshot: string;
						}>;
					};
				};
			}
		).data.stream.textDeltas;

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]).toMatchObject({
			stepIndex: 0,
			textSnapshot: 'Hey',
		});
	});

	test('flush writes dumps under project state debug-dumps', async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), 'otto-turn-dump-'));
		const previousOttoHome = process.env.OTTO_HOME;
		process.env.OTTO_HOME = join(projectRoot, 'otto-home');

		try {
			const dump = new TurnDumpCollector({
				sessionId: 'session-state-dumps',
				messageId: 'message-state-dumps',
				provider: 'openai',
				model: 'gpt-5.4',
				agent: 'build',
			});

			const filepath = await dump.flush(projectRoot);
			const cfg = await loadConfig(projectRoot);

			expect(filepath.startsWith(cfg.paths.debugDumpsDir)).toBe(true);
			expect(await Bun.file(filepath).exists()).toBe(true);
			expect(
				await Bun.file(join(projectRoot, '.otto', 'debug-dumps')).exists(),
			).toBe(false);
		} finally {
			if (previousOttoHome === undefined) {
				delete process.env.OTTO_HOME;
			} else {
				process.env.OTTO_HOME = previousOttoHome;
			}
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
