import { afterEach, describe, expect, test } from 'bun:test';
import { useTunnelStore } from '../packages/web-sdk/src/stores/tunnelStore';

function resetStore() {
	useTunnelStore.setState({
		isExpanded: false,
		remoteControl: { status: 'idle', url: null, error: null, progress: null },
		projectShare: { status: 'idle', url: null, error: null, progress: null },
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
});
