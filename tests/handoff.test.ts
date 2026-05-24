import { describe, expect, test } from 'bun:test';
import { COMMANDS as TUI_COMMANDS } from '../apps/tui/src/commands.ts';
import {
	buildHandoffContext,
	buildHandoffUserPrompt,
	getHandoffSystemPrompt,
	isHandoffCommand,
} from '../packages/server/src/runtime/session/handoff.ts';
import {
	COMMANDS as WEB_COMMANDS,
	findExactCommand,
	shouldSendSlashCommandAsMessage,
} from '../packages/web-sdk/src/lib/commands.ts';

describe('/handoff command', () => {
	test('detects exact handoff slash command', () => {
		expect(isHandoffCommand('/handoff')).toBe(true);
		expect(isHandoffCommand('  /HANDOFF  ')).toBe(true);
		expect(isHandoffCommand('/handoff now')).toBe(false);
		expect(isHandoffCommand('/compact')).toBe(false);
	});

	test('builds continuation context for the new session', () => {
		const sourceSession = {
			id: 'source-session',
			title: 'Original session',
			agent: 'general',
			provider: 'openai',
			model: 'gpt-4o-mini',
			projectPath: '/repo',
			createdAt: 1,
			lastActiveAt: 1,
			lastViewedAt: 1,
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
		} as const;
		const context = buildHandoffContext({
			createdAt: new Date('2026-05-24T00:00:00.000Z'),
			context: '[USER]: Add handoff\n[ASSISTANT]: Implemented core flow',
			sourceSession,
		});
		const prompt = buildHandoffUserPrompt({
			sourceSession,
			rawContext: '[USER]: Add handoff',
		});

		expect(context).toContain('# Session Handoff');
		expect(context).toContain('Source session: source-session');
		expect(context).toContain('Created: 2026-05-24T00:00:00.000Z');
		expect(context).toContain(
			'Inherited agent/model: general / openai:gpt-4o-mini',
		);
		expect(context).toContain('[USER]: Add handoff');
		expect(getHandoffSystemPrompt()).toContain('Start with "# Handoff"');
		expect(prompt).toContain('<session-context-to-summarize>');
		expect(prompt).toContain('[USER]: Add handoff');
	});

	test('exposes /handoff as an actionable UI command', () => {
		expect(WEB_COMMANDS.some((command) => command.id === 'handoff')).toBe(true);
		expect(TUI_COMMANDS.some((command) => command.name === 'handoff')).toBe(
			true,
		);
		expect(findExactCommand('/handoff')?.id).toBe('handoff');
		expect(shouldSendSlashCommandAsMessage('handoff')).toBe(false);
	});
});
