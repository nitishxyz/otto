import { describe, expect, test } from 'bun:test';
import pinnedMetadata from '../packages/web-sdk/src/assets/ghostty/ghostty-vt.json';
import {
	createGhosttyVtMetadata,
	parseUpdateOptions,
	sha256,
} from '../scripts/update-ghostty-vt';

describe('ghostty-vt updater', () => {
	test('defaults to the recorded pin and parses explicit provenance checks', () => {
		expect(parseUpdateOptions([])).toEqual({
			ref: pinnedMetadata.ref,
			inspect: false,
			help: false,
		});
		expect(
			parseUpdateOptions([
				'--ref',
				'v1.2.3',
				'--sha256',
				'a'.repeat(64),
				'--commit',
				'b'.repeat(40),
			]),
		).toEqual({
			ref: 'v1.2.3',
			expectedSha256: 'a'.repeat(64),
			expectedCommit: 'b'.repeat(40),
			inspect: false,
			help: false,
		});
	});

	test('rejects malformed digests, commits, and unknown options', () => {
		expect(() => parseUpdateOptions(['--sha256', 'nope'])).toThrow(
			'64-character',
		);
		expect(() => parseUpdateOptions(['--commit', 'nope'])).toThrow(
			'40-character',
		);
		expect(() => parseUpdateOptions(['--unknown'])).toThrow('Unknown option');
	});

	test('computes deterministic metadata and SHA-256 without network access', () => {
		const bytes = new TextEncoder().encode('official ghostty-vt');
		const digest = sha256(bytes);
		expect(digest).toBe(
			'28a8c45f01284cf073e42bf3d82f0298a3cb36f7c5626c9a616f909f04601e65',
		);
		expect(
			createGhosttyVtMetadata({
				ref: 'v1.2.3',
				upstreamCommit: 'b'.repeat(40),
				sourceUrl:
					'https://github.com/ghostty-org/ghostty/releases/download/v1.2.3/ghostty-vt.wasm',
				retrieved: '2026-08-16',
				size: bytes.byteLength,
				sha256: digest,
			}),
		).toEqual({
			repository: 'ghostty-org/ghostty',
			ref: 'v1.2.3',
			upstreamCommit: 'b'.repeat(40),
			sourceUrl:
				'https://github.com/ghostty-org/ghostty/releases/download/v1.2.3/ghostty-vt.wasm',
			retrieved: '2026-08-16',
			size: bytes.byteLength,
			sha256: digest,
		});
	});
});
