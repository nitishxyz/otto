import { afterEach, describe, expect, test } from 'bun:test';
import { useTunnelStore } from '../packages/web-sdk/src/stores/tunnelStore';

function idleScope() {
	return {
		status: 'idle' as const,
		url: null,
		error: null,
		progress: null,
		mode: 'quick' as const,
		hostname: null,
	};
}

function resetStore() {
	useTunnelStore.setState({
		isExpanded: false,
		remoteControl: idleScope(),
		projectShare: idleScope(),
		ottorouterConnected: false,
	});
}

afterEach(() => {
	resetStore();
});

describe('tunnelStore scope isolation', () => {
	test('patchScope updates only the targeted scope', () => {
		const { patchScope } = useTunnelStore.getState();
		patchScope('remote-control', {
			status: 'connected',
			url: 'https://remote.example.com',
		});

		const state = useTunnelStore.getState();
		expect(state.remoteControl.status).toBe('connected');
		expect(state.remoteControl.url).toBe('https://remote.example.com');
		expect(state.projectShare.status).toBe('idle');
		expect(state.projectShare.url).toBeNull();
	});

	test('project-share scope is independent of remote-control', () => {
		const { patchScope } = useTunnelStore.getState();
		patchScope('remote-control', { status: 'connected' });
		patchScope('project-share', {
			status: 'connected',
			url: 'https://share.example.com',
		});

		const state = useTunnelStore.getState();
		expect(state.remoteControl.status).toBe('connected');
		expect(state.projectShare.status).toBe('connected');
		expect(state.projectShare.url).toBe('https://share.example.com');
	});

	test('resetScope clears only the targeted scope', () => {
		const { patchScope, resetScope } = useTunnelStore.getState();
		patchScope('remote-control', {
			status: 'connected',
			url: 'https://remote.example.com',
		});
		patchScope('project-share', {
			status: 'connected',
			url: 'https://share.example.com',
		});

		resetScope('project-share');

		const state = useTunnelStore.getState();
		expect(state.remoteControl.status).toBe('connected');
		expect(state.remoteControl.url).toBe('https://remote.example.com');
		expect(state.projectShare.status).toBe('idle');
		expect(state.projectShare.url).toBeNull();
	});

	test('scope setters mutate the matching slice', () => {
		const { setScopeStatus, setScopeError, setScopeProgress } =
			useTunnelStore.getState();
		setScopeStatus('project-share', 'error');
		setScopeError('project-share', 'boom');
		setScopeProgress('remote-control', 'Connecting...');

		const state = useTunnelStore.getState();
		expect(state.projectShare.status).toBe('error');
		expect(state.projectShare.error).toBe('boom');
		expect(state.remoteControl.progress).toBe('Connecting...');
		expect(state.remoteControl.status).toBe('idle');
	});

	test('patchScope updates mode and hostname independently', () => {
		const { patchScope } = useTunnelStore.getState();
		patchScope('remote-control', {
			mode: 'managed',
			hostname: 'device.ottorouter.org',
			status: 'connected',
		});

		const state = useTunnelStore.getState();
		expect(state.remoteControl.mode).toBe('managed');
		expect(state.remoteControl.hostname).toBe('device.ottorouter.org');
		expect(state.projectShare.mode).toBe('quick');
		expect(state.projectShare.hostname).toBeNull();
	});

	test('setOttorouterConnected toggles the shared flag', () => {
		const { setOttorouterConnected } = useTunnelStore.getState();
		expect(useTunnelStore.getState().ottorouterConnected).toBe(false);
		setOttorouterConnected(true);
		expect(useTunnelStore.getState().ottorouterConnected).toBe(true);
	});

	test('resetScope restores default mode and hostname', () => {
		const { patchScope, resetScope } = useTunnelStore.getState();
		patchScope('remote-control', {
			mode: 'managed',
			hostname: 'device.ottorouter.org',
			status: 'connected',
		});
		resetScope('remote-control');

		const state = useTunnelStore.getState();
		expect(state.remoteControl.mode).toBe('quick');
		expect(state.remoteControl.hostname).toBeNull();
		expect(state.remoteControl.status).toBe('idle');
	});
});
