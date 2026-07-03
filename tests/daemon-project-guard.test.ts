import { afterAll, describe, expect, it } from 'bun:test';
import { createApp, setDaemonId } from '@ottocode/server';

const app = createApp();

afterAll(() => {
	setDaemonId(null);
});

describe('daemon project context guard', () => {
	it('rejects project-less requests when running as daemon', async () => {
		setDaemonId('daemon-test');
		const res = await app.request('/v1/config');
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error?: { code?: string; message?: string };
		};
		expect(body.error?.code).toBe('project_context_required');
	});

	it('accepts requests with an explicit project path when running as daemon', async () => {
		setDaemonId('daemon-test');
		const res = await app.request(
			`/v1/config?project=${encodeURIComponent(process.cwd())}`,
		);
		expect(res.status).toBe(200);
	});

	it('falls back to cwd for non-daemon single-project servers', async () => {
		setDaemonId(null);
		const res = await app.request('/v1/config');
		expect(res.status).toBe(200);
	});
});
