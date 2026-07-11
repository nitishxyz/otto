import { afterEach, describe, expect, test } from 'bun:test';
import {
	acquireAuthenticatedAsset,
	invalidateAuthenticatedAssets,
} from '../packages/web-sdk/src/lib/authenticated-asset.ts';
import { setRuntimeProjectContext } from '../packages/web-sdk/src/lib/config.ts';
import { clearShareMode } from '../packages/web-sdk/src/lib/share-mode.ts';

const originalWindow = globalThis.window;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function installWindow() {
	const values = new Map<string, string>();
	globalThis.window = {
		sessionStorage: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		},
	} as unknown as Window & typeof globalThis;
	return globalThis.window as Window & {
		__OTTO_SHARE_TOKEN__?: string;
	};
}

afterEach(() => {
	clearShareMode();
	invalidateAuthenticatedAssets();
	globalThis.window = originalWindow;
	URL.createObjectURL = originalCreateObjectURL;
	URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('authenticated attachment image resolver', () => {
	test('fetches owner images with memory-only owner header and revokes object URL', async () => {
		installWindow();
		setRuntimeProjectContext({
			projectId: 'project-owner',
			ownerSession: { token: 'owner-secret', expiresAt: Date.now() + 60_000 },
		});
		const requests: RequestInit[] = [];
		const revoked: string[] = [];
		URL.createObjectURL = () => 'blob:owner-image';
		URL.revokeObjectURL = (url) => revoked.push(url);
		const fetcher = (async (_url: string, init?: RequestInit) => {
			requests.push(init ?? {});
			return new Response(new Blob(['image']), { status: 200 });
		}) as typeof fetch;

		const asset = await acquireAuthenticatedAsset(
			'https://machine/v1/attachments/att_1?projectId=project-owner',
			fetcher,
		);
		expect(asset.url).toBe('blob:owner-image');
		const headers = new Headers(requests[0]?.headers);
		expect(headers.get('x-otto-owner-session')).toBe('owner-secret');
		expect(headers.get('x-otto-project-id')).toBe('project-owner');
		expect(requests[0]?.credentials).toBe('include');
		asset.release();
		expect(revoked).toEqual(['blob:owner-image']);
	});

	test('uses only share header in share mode and deduplicates concurrent fetches', async () => {
		const win = installWindow();
		win.__OTTO_SHARE_TOKEN__ = 'share-secret';
		setRuntimeProjectContext({
			projectId: 'attacker-project',
			serverToken: 'daemon-secret',
		});
		let calls = 0;
		URL.createObjectURL = () => 'blob:share-image';
		const fetcher = (async (_url: string, init?: RequestInit) => {
			calls += 1;
			const headers = new Headers(init?.headers);
			expect(headers.get('x-otto-share-token')).toBe('share-secret');
			expect(headers.has('authorization')).toBe(false);
			expect(headers.has('x-otto-project-id')).toBe(false);
			return new Response(new Blob(['image']), { status: 200 });
		}) as typeof fetch;

		const [first, second] = await Promise.all([
			acquireAuthenticatedAsset(
				'https://machine/v1/attachments/att_2',
				fetcher,
			),
			acquireAuthenticatedAsset(
				'https://machine/v1/attachments/att_2',
				fetcher,
			),
		]);
		expect(calls).toBe(1);
		first.release();
		second.release();
	});

	test('rejects unauthorized attachment responses without creating object URLs', async () => {
		installWindow();
		let created = false;
		URL.createObjectURL = () => {
			created = true;
			return 'blob:unexpected';
		};
		expect(
			acquireAuthenticatedAsset(
				'https://machine/v1/attachments/att_denied',
				(async () =>
					new Response('Unauthorized', { status: 401 })) as typeof fetch,
			),
		).rejects.toThrow('HTTP 401');
		expect(created).toBe(false);
	});
});
