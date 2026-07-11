import { afterEach, describe, expect, it } from 'bun:test';
import * as shareMode from '../packages/web-sdk/src/lib/share-mode.ts';

interface MockSessionStorage {
	store: Map<string, string>;
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function createSessionStorage(): MockSessionStorage {
	const store = new Map<string, string>();
	return {
		store,
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => {
			store.set(key, value);
		},
		removeItem: (key) => {
			store.delete(key);
		},
	};
}

function installWindow(href: string, runtimeContext?: unknown) {
	let currentHref = href;
	const replaced: string[] = [];
	const win = {
		location: {
			get href() {
				return currentHref;
			},
			get search() {
				return new URL(currentHref).search;
			},
		},
		history: {
			replaceState: (_state: unknown, _title: string, url: string) => {
				replaced.push(url);
				const next = new URL(url, currentHref);
				currentHref = next.toString();
			},
		},
		sessionStorage: createSessionStorage(),
		localStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
		},
		OTTO_SERVER_URL: 'http://127.0.0.1:4321',
		OTTO_RUNTIME_CONTEXT: runtimeContext,
	} as Record<string, unknown> & { __replaced: string[] };
	win.__replaced = replaced;
	(globalThis as unknown as { window: unknown }).window = win;
	return win;
}

afterEach(() => {
	delete (globalThis as unknown as { window?: unknown }).window;
});

describe('share-mode boot', () => {
	it('consumes ?share= token, stores it, and strips the URL', () => {
		const win = installWindow(
			'https://device.example/?share=share-token-abc&foo=bar',
		);

		const token = shareMode.consumeShareBoot();

		expect(token).toBe('share-token-abc');
		expect(shareMode.isShareMode()).toBe(true);
		expect(shareMode.getShareToken()).toBe('share-token-abc');
		expect(win.sessionStorage.getItem(shareMode.SHARE_TOKEN_STORAGE_KEY)).toBe(
			'share-token-abc',
		);

		const replaced = (win.__replaced as string[]).at(-1) ?? '';
		expect(replaced).not.toContain('share=');
		expect(replaced).toContain('foo=bar');
	});

	it('builds a distinct share auth header and no owner credentials', () => {
		installWindow('https://device.example/?share=share-token-xyz');
		shareMode.consumeShareBoot();

		expect(shareMode.getShareAuthHeaders()).toEqual({
			'X-Otto-Share-Token': 'share-token-xyz',
		});
	});

	it('activates an explicit token and clears stale pinned project state', () => {
		installWindow('tauri://localhost/');
		shareMode.activateShareMode(' first-token ');
		shareMode.setSharePinnedProjectId('stale-project');

		shareMode.activateShareMode('second-token');

		expect(shareMode.getShareToken()).toBe('second-token');
		expect(shareMode.getSharePinnedProjectId()).toBeUndefined();
		expect(shareMode.getShareAuthHeaders()).toEqual({
			'X-Otto-Share-Token': 'second-token',
		});
	});

	it('is inert when no ?share= param is present', () => {
		installWindow('https://device.example/');
		const token = shareMode.consumeShareBoot();
		expect(token).toBeUndefined();
		expect(shareMode.isShareMode()).toBe(false);
		expect(shareMode.getShareAuthHeaders()).toEqual({});
	});

	it('pins and clears the resolved share project id', () => {
		installWindow('https://device.example/?share=share-token-pin');
		shareMode.consumeShareBoot();
		shareMode.setSharePinnedProjectId('project-pinned');
		expect(shareMode.getSharePinnedProjectId()).toBe('project-pinned');

		shareMode.clearShareMode();
		expect(shareMode.isShareMode()).toBe(false);
		expect(shareMode.getSharePinnedProjectId()).toBeUndefined();
	});

	it('never falls back to an injected owner project in share mode', async () => {
		installWindow('https://device.example/sessions?share=share-token-pin', {
			projectId: 'owner-project',
			projectRoot: '/tmp/owner-project',
		});
		shareMode.consumeShareBoot();
		const { getProjectQuery, projectScopedKey } = await import(
			'../packages/web-sdk/src/lib/api-client/utils.ts'
		);

		expect(getProjectQuery()).toEqual({});
		expect(projectScopedKey(['sessions'] as const)).toEqual([
			'project',
			'default',
			'sessions',
		]);

		shareMode.setSharePinnedProjectId('shared-project');
		expect(getProjectQuery()).toEqual({ projectId: 'shared-project' });
	});
});
