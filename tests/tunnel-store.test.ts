import { afterEach, describe, expect, test } from 'bun:test';
import {
	tunnelSlotKey,
	useTunnelStore,
} from '../packages/web-sdk/src/stores/tunnelStore';

function idleSlot() {
	return {
		status: 'idle' as const,
		url: null,
		error: null,
		progress: null,
		hostname: null,
	};
}

function resetStore() {
	useTunnelStore.setState({
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

describe('tunnelSlotKey', () => {
	test('maps scope + mode onto dedicated slots', () => {
		expect(tunnelSlotKey('remote-control', 'managed')).toBe('remoteManaged');
		expect(tunnelSlotKey('remote-control', 'quick')).toBe('remoteQuick');
		expect(tunnelSlotKey('remote-control')).toBe('remoteQuick');
		expect(tunnelSlotKey('project-share', 'quick')).toBe('projectShare');
		expect(tunnelSlotKey('project-share', 'managed')).toBe('projectShare');
	});
});

describe('tunnelStore slot isolation', () => {
	test('patchSlot updates only the targeted slot', () => {
		const { patchSlot } = useTunnelStore.getState();
		patchSlot('remoteManaged', {
			status: 'connected',
			url: 'https://remote.example.com',
			hostname: 'remote.example.com',
		});

		const state = useTunnelStore.getState();
		expect(state.remoteManaged.status).toBe('connected');
		expect(state.remoteManaged.url).toBe('https://remote.example.com');
		expect(state.remoteQuick.status).toBe('idle');
		expect(state.projectShare.status).toBe('idle');
	});

	test('quick remote-control status can never clobber live managed state', () => {
		// Regression: a mode=quick status poll used to overwrite the shared
		// remote-control scope, flipping a live managed tunnel back to "Off".
		const { patchSlot } = useTunnelStore.getState();
		patchSlot('remoteManaged', {
			status: 'connected',
			url: 'https://abc.ottorouter.org',
			hostname: 'abc.ottorouter.org',
		});
		patchSlot('remoteQuick', { status: 'idle', url: null });

		const state = useTunnelStore.getState();
		expect(state.remoteManaged.status).toBe('connected');
		expect(state.remoteManaged.url).toBe('https://abc.ottorouter.org');
		expect(state.remoteManaged.hostname).toBe('abc.ottorouter.org');
	});

	test('project-share slot is independent of remote-control slots', () => {
		const { patchSlot } = useTunnelStore.getState();
		patchSlot('remoteManaged', { status: 'connected' });
		patchSlot('projectShare', {
			status: 'connected',
			url: 'https://share.example.com',
		});

		const state = useTunnelStore.getState();
		expect(state.remoteManaged.status).toBe('connected');
		expect(state.projectShare.status).toBe('connected');
		expect(state.projectShare.url).toBe('https://share.example.com');
	});

	test('resetSlot clears only the targeted slot', () => {
		const { patchSlot, resetSlot } = useTunnelStore.getState();
		patchSlot('remoteManaged', {
			status: 'connected',
			url: 'https://remote.example.com',
			hostname: 'remote.example.com',
		});
		patchSlot('projectShare', {
			status: 'connected',
			url: 'https://share.example.com',
		});

		resetSlot('projectShare');

		const state = useTunnelStore.getState();
		expect(state.remoteManaged.status).toBe('connected');
		expect(state.remoteManaged.hostname).toBe('remote.example.com');
		expect(state.projectShare.status).toBe('idle');
		expect(state.projectShare.url).toBeNull();
	});

	test('resetSlot restores defaults including hostname', () => {
		const { patchSlot, resetSlot } = useTunnelStore.getState();
		patchSlot('remoteManaged', {
			status: 'connected',
			hostname: 'device.ottorouter.org',
		});
		resetSlot('remoteManaged');

		const state = useTunnelStore.getState();
		expect(state.remoteManaged.status).toBe('idle');
		expect(state.remoteManaged.hostname).toBeNull();
	});

	test('setOttorouterConnected toggles the shared flag', () => {
		const { setOttorouterConnected } = useTunnelStore.getState();
		expect(useTunnelStore.getState().ottorouterConnected).toBe(false);
		setOttorouterConnected(true);
		expect(useTunnelStore.getState().ottorouterConnected).toBe(true);
	});
});
