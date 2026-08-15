import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('remote desktop event transport', () => {
	test('uses the native owner-authenticated project stream', async () => {
		const [sdk, transport, broker] = await Promise.all([
			readFile('src/lib/sdk-client.ts', 'utf8'),
			readFile('src/lib/desktop-event-stream.ts', 'utf8'),
			readFile('src-tauri/src/commands/desktop_events.rs', 'utf8'),
		]);

		expect(sdk).toContain("authMode: 'owner'");
		expect(transport).toContain("'subscribe_remote_project_events'");
		expect(transport).toContain('payload.subscriptionId !== subscriptionId');
		expect(broker).toContain('.header("x-otto-owner-session", &owner_session)');
		expect(broker).toContain('subscription_id: subscription_id.clone()');
	});
});
