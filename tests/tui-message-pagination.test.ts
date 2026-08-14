import { afterEach, describe, expect, test } from 'bun:test';
import { client } from '@ottocode/api';
import {
	loadSessionMessagePage,
	MESSAGE_PARTS_PAGE_TARGET,
} from '../apps/tui/src/stream/client.ts';

const originalAdapter = client.getConfig().adapter;

afterEach(() => {
	client.setConfig({ adapter: originalAdapter });
});

describe('TUI message pagination', () => {
	test('requests a part-bounded cursor page and normalizes parsed content', async () => {
		let requestUrl = '';
		client.setConfig({
			adapter: async (config) => {
				requestUrl = String(config.url ?? '');
				return {
					data: {
						items: [
							{
								id: 'message-1',
								sessionId: 'session-1',
								role: 'assistant',
								status: 'complete',
								agent: 'build',
								provider: 'anthropic',
								model: 'claude',
								createdAt: 1,
								parts: [
									{
										id: 'part-1',
										messageId: 'message-1',
										index: 0,
										type: 'text',
										content: { text: 'hello' },
										agent: 'build',
										provider: 'anthropic',
										model: 'claude',
									},
								],
							},
						],
						partCount: 1,
						hasMore: true,
						nextCursor: 'older-cursor',
					},
					status: 200,
					statusText: 'OK',
					headers: {},
					config,
				};
			},
		});

		const page = await loadSessionMessagePage('session-1', 'cursor-1');

		expect(requestUrl).toContain('/v1/sessions/session-1/messages/page');
		expect(requestUrl).toContain(`limit=${MESSAGE_PARTS_PAGE_TARGET}`);
		expect(requestUrl).toContain('cursor=cursor-1');
		expect(page.nextCursor).toBe('older-cursor');
		expect(page.items[0]?.parts?.[0]?.contentJson).toEqual({ text: 'hello' });
		expect(page.items[0]?.parts?.[0]?.content).toBe('{"text":"hello"}');
	});
});
