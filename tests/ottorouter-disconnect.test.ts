import { afterEach, describe, expect, test } from 'bun:test';
import {
	disconnectOttoRouter,
	ottoRouterDisconnectTesting,
} from '../packages/server/src/routes/auth/ottorouter-disconnect.ts';

afterEach(() => {
	ottoRouterDisconnectTesting.reset();
});

describe('OttoRouter disconnect lifecycle', () => {
	test('disables managed tunnel before removing credentials', async () => {
		const calls: string[] = [];
		ottoRouterDisconnectTesting.setStopManagedTunnel(async () => {
			calls.push('disable');
			return { ok: true };
		});
		ottoRouterDisconnectTesting.setRemoveProviderAuth(async () => {
			calls.push('remove-auth');
		});

		expect(await disconnectOttoRouter()).toEqual({
			success: true,
			provider: 'ottorouter',
			tunnelDisabled: true,
			authRemoved: true,
		});
		expect(calls).toEqual(['disable', 'remove-auth']);
	});

	test('already stopped managed tunnel still removes credentials successfully', async () => {
		let removed = false;
		ottoRouterDisconnectTesting.setStopManagedTunnel(async () => ({
			ok: true,
		}));
		ottoRouterDisconnectTesting.setRemoveProviderAuth(async () => {
			removed = true;
		});

		const result = await disconnectOttoRouter();
		expect(result.success).toBe(true);
		expect(result.tunnelDisabled).toBe(true);
		expect(removed).toBe(true);
	});

	test('removes credentials even when managed disable fails and combines errors', async () => {
		ottoRouterDisconnectTesting.setStopManagedTunnel(async () => {
			throw new Error('state disk unavailable');
		});
		ottoRouterDisconnectTesting.setRemoveProviderAuth(async () => {
			throw new Error('auth disk unavailable');
		});

		expect(await disconnectOttoRouter()).toEqual({
			success: false,
			provider: 'ottorouter',
			tunnelDisabled: false,
			authRemoved: false,
			error:
				'Managed tunnel: state disk unavailable; Credentials: auth disk unavailable',
		});
	});
});
