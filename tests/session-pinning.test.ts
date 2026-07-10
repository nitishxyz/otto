import { describe, expect, it } from 'bun:test';
import { buildSessionPreferenceUpdates } from '../packages/server/src/routes/sessions/service.ts';

type BuildArgs = Parameters<typeof buildSessionPreferenceUpdates>;

const cfg = { projectRoot: '/tmp/otto-test' } as BuildArgs[0];

const baseSession = {
	id: 'session-1',
	title: 'Existing session',
	agent: 'build',
	provider: 'anthropic',
	model: 'claude-sonnet-4-5',
	projectPath: '/tmp/otto-test',
	createdAt: 1000,
	lastActiveAt: 2000,
	lastViewedAt: 2000,
	pinnedAt: null,
	totalInputTokens: null,
	totalOutputTokens: null,
	totalCachedTokens: null,
	totalCacheCreationTokens: null,
	totalReasoningTokens: null,
	totalToolTimeMs: null,
	toolCountsJson: null,
	currentContextTokens: null,
	contextSummary: null,
	lastCompactedAt: null,
	parentSessionId: null,
	branchPointMessageId: null,
	sessionType: 'main',
} as BuildArgs[1];

describe('session pinning preference updates', () => {
	it('pins without changing last activity time', async () => {
		const result = await buildSessionPreferenceUpdates(cfg, baseSession, {
			isPinned: true,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(typeof result.updates.pinnedAt).toBe('number');
		expect(result.updates.lastActiveAt).toBeUndefined();
	});

	it('unpins without changing last activity time', async () => {
		const result = await buildSessionPreferenceUpdates(
			cfg,
			{ ...baseSession, pinnedAt: 3000 },
			{ isPinned: false },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.updates.pinnedAt).toBeNull();
		expect(result.updates.lastActiveAt).toBeUndefined();
	});
});
