import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
	createApp,
	setDaemonId,
	setDefaultProjectRoot,
} from '@ottocode/server';

const app = createApp();

beforeEach(() => {
	setDaemonId(null);
	setDefaultProjectRoot(null);
});

afterEach(() => {
	setDaemonId(null);
	setDefaultProjectRoot(null);
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

	it('allows project-less onboarding status and model requests', async () => {
		setDaemonId('daemon-test');

		const statusResponse = await app.request('/v1/auth/status');
		expect(statusResponse.status).toBe(200);

		const modelsResponse = await app.request('/v1/config/models');
		expect(modelsResponse.status).toBe(200);
		expect(await modelsResponse.json()).toBeTypeOf('object');
	});

	it('accepts requests with an explicit project path when running as daemon', async () => {
		setDaemonId('daemon-test');
		const res = await app.request(
			`/v1/config?project=${encodeURIComponent(process.cwd())}`,
		);
		expect(res.status).toBe(200);
	});

	it('rejects contextless requests without an explicit default root', async () => {
		const res = await app.request('/v1/config');
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error?: { code?: string };
		};
		expect(body.error?.code).toBe('project_context_required');
	});

	it('uses a registered default root for single-project servers', async () => {
		setDefaultProjectRoot(process.cwd());
		const res = await app.request('/v1/config');
		expect(res.status).toBe(200);
	});

	it('returns 404 for an unknown project id instead of using a fallback', async () => {
		setDefaultProjectRoot(process.cwd());
		const res = await app.request(
			'/v1/config?projectId=unknown-project-id-for-routing-test',
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			error?: { message?: string; status?: number };
		};
		expect(body.error?.message).toContain('Project not found');
		expect(body.error?.status).toBe(404);
	});
});
