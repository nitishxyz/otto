import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { normalizeTunnelStatus } from '../packages/web-sdk/src/lib/tunnel-shared';
import {
	resolveProjectShareView,
	resolveRemoteControlView,
} from '../packages/web-sdk/src/lib/tunnel-views';
import { useTunnelStore } from '../packages/web-sdk/src/stores/tunnelStore';
import { TunnelSidebar } from '../packages/web-sdk/src/components/tunnel/TunnelSidebar';

function idleSlot() {
	return {
		status: 'idle' as const,
		url: null,
		error: null,
		progress: null,
		hostname: null,
	};
}

type SeedState = {
	isExpanded: boolean;
	remoteManaged: ReturnType<typeof idleSlot>;
	remoteQuick: ReturnType<typeof idleSlot>;
	projectShare: ReturnType<typeof idleSlot>;
	ottorouterConnected: boolean;
};

/**
 * Seeds both the live state and the initial-state object. renderToStaticMarkup
 * takes React's server path, where zustand serves useSyncExternalStore's
 * server snapshot from the store's captured initial state, so that object must
 * carry the scenario under test too.
 */
function seedStore(state: SeedState) {
	useTunnelStore.setState(state);
	Object.assign(useTunnelStore.getInitialState(), state);
}

function resetStore() {
	seedStore({
		isExpanded: false,
		remoteManaged: idleSlot(),
		remoteQuick: idleSlot(),
		projectShare: idleSlot(),
		ottorouterConnected: false,
	});
}

afterEach(() => {
	resetStore();
});

describe('remote control view matrix', () => {
	test('live managed tunnel is authoritative regardless of the flag', () => {
		expect(
			resolveRemoteControlView({
				managedStatus: 'connected',
				ottorouterConnected: true,
			}),
		).toBe('managed-live');
		// Auto-restored tunnel racing the first status poll must still win.
		expect(
			resolveRemoteControlView({
				managedStatus: 'connected',
				ottorouterConnected: false,
			}),
		).toBe('managed-live');
	});

	test('starting and error managed states map to their panels', () => {
		expect(
			resolveRemoteControlView({
				managedStatus: 'starting',
				ottorouterConnected: true,
			}),
		).toBe('managed-starting');
		expect(
			resolveRemoteControlView({
				managedStatus: 'error',
				ottorouterConnected: false,
			}),
		).toBe('managed-error');
	});

	test('idle managed splits on the OttoRouter connection', () => {
		expect(
			resolveRemoteControlView({
				managedStatus: 'idle',
				ottorouterConnected: true,
			}),
		).toBe('managed-off');
		expect(
			resolveRemoteControlView({
				managedStatus: 'idle',
				ottorouterConnected: false,
			}),
		).toBe('ottorouter-disconnected');
	});
});

describe('project share view matrix', () => {
	test('managed shares are available while the managed tunnel is online', () => {
		expect(
			resolveProjectShareView({
				managedStatus: 'connected',
				ottorouterConnected: true,
			}),
		).toBe('managed-shares');
		expect(
			resolveProjectShareView({
				managedStatus: 'connected',
				ottorouterConnected: false,
			}),
		).toBe('managed-shares');
	});

	test('managed unavailable but reachable explains the prerequisite', () => {
		expect(
			resolveProjectShareView({
				managedStatus: 'idle',
				ottorouterConnected: true,
			}),
		).toBe('managed-shares-waiting');
		expect(
			resolveProjectShareView({
				managedStatus: 'starting',
				ottorouterConnected: true,
			}),
		).toBe('managed-shares-waiting');
		expect(
			resolveProjectShareView({
				managedStatus: 'error',
				ottorouterConnected: false,
			}),
		).toBe('managed-shares-waiting');
	});

	test('quick share is primary only when OttoRouter is disconnected', () => {
		expect(
			resolveProjectShareView({
				managedStatus: 'idle',
				ottorouterConnected: false,
			}),
		).toBe('quick-share');
	});
});

describe('cross-surface transitions', () => {
	const LIVE_PAYLOAD = {
		mode: 'managed',
		scope: 'remote-control',
		status: 'connected' as const,
		url: 'https://abc.ottorouter.org',
		error: null,
		isRunning: true,
		hostname: 'abc.ottorouter.org',
		ottorouterConnected: true,
	};

	function applyManagedStatus(payload: {
		status: 'idle' | 'starting' | 'connected' | 'error';
		url: string | null;
		error: string | null;
		isRunning: boolean;
		hostname: string | null;
		ottorouterConnected: boolean;
	}) {
		// Mirrors what useTunnelStatus does with a managed daemon payload.
		useTunnelStore.getState().patchSlot('remoteManaged', {
			status: normalizeTunnelStatus(payload),
			url: payload.url,
			error: payload.error,
			hostname: payload.hostname,
		});
		useTunnelStore
			.getState()
			.setOttorouterConnected(payload.ottorouterConnected);
	}

	test('desktop enable then a stale quick poll keeps the sidebar live', () => {
		applyManagedStatus(LIVE_PAYLOAD);
		// Stale quick-mode remote-control status arriving afterwards (the old
		// bug overwrote the shared scope and flipped the panel to Off).
		useTunnelStore
			.getState()
			.patchSlot('remoteQuick', { status: 'idle', url: null });

		const state = useTunnelStore.getState();
		expect(
			resolveRemoteControlView({
				managedStatus: state.remoteManaged.status,
				ottorouterConnected: state.ottorouterConnected,
			}),
		).toBe('managed-live');
		expect(state.remoteManaged.hostname).toBe('abc.ottorouter.org');
	});

	test('desktop disable flips the sidebar to managed-off', () => {
		applyManagedStatus(LIVE_PAYLOAD);
		applyManagedStatus({
			status: 'idle',
			url: null,
			error: null,
			isRunning: false,
			hostname: null,
			ottorouterConnected: true,
		});

		const state = useTunnelStore.getState();
		expect(
			resolveRemoteControlView({
				managedStatus: state.remoteManaged.status,
				ottorouterConnected: state.ottorouterConnected,
			}),
		).toBe('managed-off');
	});

	test('daemon race window renders as starting, never off', () => {
		applyManagedStatus({
			...LIVE_PAYLOAD,
			status: 'idle',
			url: null,
			hostname: null,
			isRunning: true,
		});
		const state = useTunnelStore.getState();
		expect(
			resolveRemoteControlView({
				managedStatus: state.remoteManaged.status,
				ottorouterConnected: state.ottorouterConnected,
			}),
		).toBe('managed-starting');
	});
});

describe('sidebar render regression', () => {
	function renderSidebar(): string {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		try {
			return renderToStaticMarkup(
				createElement(
					QueryClientProvider,
					{ client: queryClient },
					createElement(TunnelSidebar),
				),
			);
		} finally {
			queryClient.clear();
		}
	}

	test('live managed status never renders Turn on remote access', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: {
				status: 'connected',
				url: 'https://abc.ottorouter.org',
				error: null,
				progress: null,
				hostname: 'abc.ottorouter.org',
			},
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		expect(html).toContain('abc.ottorouter.org');
		expect(html).toContain('Active');
		expect(html).toContain('Turn off');
		expect(html).not.toContain('Turn on remote access');
		expect(html).not.toContain('Connect OttoRouter');
	});

	test('live managed card is compact, owner-only, and shows the hostname once', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: {
				status: 'connected',
				url: 'https://abc.ottorouter.org',
				error: null,
				progress: null,
				hostname: 'abc.ottorouter.org',
			},
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		// Hostname appears exactly once, in the copyable compact row.
		expect(html.split('abc.ottorouter.org').length - 1).toBe(1);
		expect(html).toContain('Copy remote control link');
		// Owner-only semantics live in title/aria, not visible body copy.
		expect(html).toContain('OttoRouter account owner');
		expect(html).toContain('OttoCode app');
		expect(html).not.toContain('Owner access to every project');
		expect(html).not.toContain('Stays on after you close');
		expect(html).not.toContain(
			'Only the OttoRouter account owner can use this link',
		);
		// Forbidden bulk UI from the old card.
		expect(html).not.toContain('Open in browser');
		expect(html).not.toContain('Anyone with this link');
		expect(html).not.toContain('qrcode');
		expect(html).toContain('Active');
		expect(html).toContain('Turn off');
		expect(html).not.toContain('Turn off remote access');
		// Flat sidebar sections: no floating card containers or boxed rows.
		expect(html).not.toContain('rounded-lg');
		expect(html).not.toContain('bg-card');
		expect(html).toContain('border-b border-border/60');
	});

	test('project share card reads as shareable and project-scoped', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: {
				status: 'connected',
				url: 'https://abc.ottorouter.org',
				error: null,
				progress: null,
				hostname: 'abc.ottorouter.org',
			},
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		expect(html).toContain('Project Share');
		// Scope is conveyed by a tiny header badge + tooltip, not sentences.
		expect(html).toContain('Current project');
		expect(html).toContain(
			'Share links grant access to only the current project',
		);
		expect(html).not.toContain('with others');
		expect(html).not.toContain('never the whole machine');
		expect(html).not.toContain('No active share links');
		expect(html).not.toContain('bg-card');
	});

	test('managed off with OttoRouter connected offers the enable action', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: idleSlot(),
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		expect(html).toContain('Turn on remote access');
		expect(html).not.toContain('Connect OttoRouter');
	});

	test('starting managed status shows progress, not the enable action', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: {
				status: 'starting',
				url: null,
				error: null,
				progress: 'Provisioning managed tunnel…',
				hostname: null,
			},
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		expect(html).toContain('Starting…');
		expect(html).toContain('Provisioning managed tunnel…');
		expect(html).not.toContain('Turn on remote access');
	});

	test('managed error shows the failure and retry', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: {
				status: 'error',
				url: null,
				error: 'Managed tunnel crashed',
				progress: null,
				hostname: null,
			},
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: true,
		});

		const html = renderSidebar();
		expect(html).toContain('Managed tunnel crashed');
		expect(html).toContain('Try Again');
		expect(html).not.toContain('Turn on remote access');
	});

	test('disconnected OttoRouter offers connect plus quick fallback only', () => {
		seedStore({
			isExpanded: true,
			remoteManaged: idleSlot(),
			remoteQuick: idleSlot(),
			projectShare: idleSlot(),
			ottorouterConnected: false,
		});

		const html = renderSidebar();
		expect(html).toContain('Connect OttoRouter');
		expect(html).toContain('Use a temporary quick tunnel');
		expect(html).not.toContain('Turn on remote access');
	});
});
