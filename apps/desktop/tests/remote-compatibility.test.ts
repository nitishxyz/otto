import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import {
	assessRemoteCompatibility,
	hostUpdateGuidance,
	isStrictlyNewerRelease,
	REMOTE_UPGRADE_CAPABILITY,
} from '../src/lib/remote-compatibility';

const protocol = (overrides?: Partial<Record<string, unknown>>) => ({
	version: 1,
	minVersion: 1,
	maxVersion: 1,
	capabilities: ['projects.list', 'remote.owner-session'],
	...overrides,
});

describe('isStrictlyNewerRelease', () => {
	test('accepts only strictly newer official x.y.z releases', () => {
		expect(isStrictlyNewerRelease('0.1.300', '0.1.347')).toBe(true);
		expect(isStrictlyNewerRelease('0.1.347', '0.1.347')).toBe(false);
		expect(isStrictlyNewerRelease('0.2.0', '0.1.347')).toBe(false);
		expect(isStrictlyNewerRelease('1.0.0', '0.9.9')).toBe(false);
	});

	test('rejects unknown, tagged, or non-release version strings', () => {
		expect(isStrictlyNewerRelease(null, '0.1.347')).toBe(false);
		expect(isStrictlyNewerRelease('0.1.300', null)).toBe(false);
		expect(isStrictlyNewerRelease('dev', '0.1.347')).toBe(false);
		expect(isStrictlyNewerRelease('0.1.300', 'v0.1.347')).toBe(false);
		expect(isStrictlyNewerRelease('0.1.300', '0.1.347-beta.1')).toBe(false);
	});
});

describe('assessRemoteCompatibility', () => {
	test('compatible hosts proceed normally', () => {
		const gate = assessRemoteCompatibility(
			{ version: '0.1.347', protocol: protocol() },
			'Studio',
		);
		expect(gate.kind).toBe('compatible');
	});

	test('an older product release remains compatible when its protocol overlaps', () => {
		const gate = assessRemoteCompatibility(
			{ version: '0.1.200', protocol: protocol() },
			'Studio',
			'0.1.347',
		);
		expect(gate.kind).toBe('compatible');
		expect(gate.result.status).toBe('compatible');
	});

	test('hosts without protocol info are limited, not blocked', () => {
		const gate = assessRemoteCompatibility({ version: '0.1.200' }, 'Studio');
		expect(gate.kind).toBe('limited');
		if (gate.kind === 'limited') {
			expect(gate.reason).toContain('Studio');
			expect(gate.result.status).toBe('unknown-legacy');
		}
		expect(assessRemoteCompatibility(null, 'Studio').kind).toBe('limited');
	});

	// Simulates a future desktop whose protocol floor moved past today's hosts.
	const futureClient = { version: 2, minVersion: 2, maxVersion: 2 };

	test('host-too-old blocks and offers upgrade only with the stage capability', () => {
		const tooOld = {
			version: '0.1.100',
			protocol: protocol({
				capabilities: [REMOTE_UPGRADE_CAPABILITY],
			}),
		};
		const withCapability = assessRemoteCompatibility(
			tooOld,
			'Studio',
			'0.1.347',
			futureClient,
		);
		expect(withCapability.kind).toBe('host-too-old');
		if (withCapability.kind === 'host-too-old') {
			expect(withCapability.hostVersion).toBe('0.1.100');
			expect(withCapability.upgradeTarget).toBe('0.1.347');
		}

		const withoutCapability = assessRemoteCompatibility(
			{ ...tooOld, protocol: protocol({ capabilities: [] }) },
			'Studio',
			'0.1.347',
			futureClient,
		);
		expect(withoutCapability.kind).toBe('host-too-old');
		if (withoutCapability.kind === 'host-too-old') {
			expect(withoutCapability.upgradeTarget).toBeNull();
			expect(withoutCapability.guidance).toBe(hostUpdateGuidance('Studio'));
			expect(withoutCapability.guidance).toContain('otto upgrade');
			expect(withoutCapability.guidance).toContain('restart');
		}
	});

	test('never offers a downgrade or same-version target', () => {
		const tooOld = {
			version: '0.1.400',
			protocol: protocol({
				capabilities: [REMOTE_UPGRADE_CAPABILITY],
			}),
		};
		const gate = assessRemoteCompatibility(
			tooOld,
			'Studio',
			'0.1.347',
			futureClient,
		);
		expect(gate.kind).toBe('host-too-old');
		if (gate.kind === 'host-too-old') {
			expect(gate.upgradeTarget).toBeNull();
		}
	});

	test('client-too-old blocks with the host version surfaced', () => {
		const gate = assessRemoteCompatibility(
			{ version: '9.0.0', protocol: protocol({ minVersion: 99, version: 99 }) },
			'Studio',
			'0.1.347',
		);
		expect(gate.kind).toBe('client-too-old');
		if (gate.kind === 'client-too-old') {
			expect(gate.hostVersion).toBe('9.0.0');
		}
	});

	test('protocol without a capability list is limited, not blocked', () => {
		const gate = assessRemoteCompatibility(
			{ version: '0.1.340', protocol: protocol({ capabilities: undefined }) },
			'Studio',
		);
		expect(gate.kind).toBe('limited');
		if (gate.kind === 'limited') {
			expect(gate.result.status).toBe('limited-legacy');
		}
	});
});

describe('picker integration (static)', () => {
	test('picker gates project rows on compatibility and wires the panels', async () => {
		const source = await readFile(
			new URL('../src/components/ConnectedProjectPicker.tsx', import.meta.url),
			'utf8',
		);
		expect(source).toContain('assessRemoteCompatibility');
		expect(source).toContain('RemoteHostTooOldPanel');
		expect(source).toContain('RemoteClientTooOldPanel');
		expect(source).toContain('RemoteLimitedNotice');
		expect(source).toContain("gate?.kind !== 'host-too-old'");
		expect(source).toContain("gate?.kind !== 'client-too-old'");
		expect(source).toContain('stageRemoteHostUpgrade');
	});

	test('stage helper calls the generated operation against the remote host', async () => {
		const source = await readFile(
			new URL('../src/lib/machine-api.ts', import.meta.url),
			'utf8',
		);
		expect(source).toContain('stageServerUpgrade');
		expect(source).toContain('X-Otto-Owner-Session');
		expect(source).toContain('baseURL: apiUrl');
		expect(source).toContain('never replaced or restarted');
	});

	test('host panel says staging requires an owner restart and never auto-applies', async () => {
		const source = await readFile(
			new URL(
				'../src/components/RemoteCompatibilityPanel.tsx',
				import.meta.url,
			),
			'utf8',
		);
		expect(source).toContain('not replaced or restarted');
		expect(source).toContain('restart');
		expect(source).toContain('useUpdate');
	});
});
