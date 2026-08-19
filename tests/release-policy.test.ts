import { describe, expect, test } from 'bun:test';
import {
	compareReleaseVersions,
	getOfficialReleaseUrl,
	getReleaseAssetName,
	parseReleaseVersion,
} from '@ottocode/sdk/release';

describe('release identity policy', () => {
	test.each([
		['1.2.3', '1.2.3', 'v1.2.3'],
		['v1.2.3', '1.2.3', 'v1.2.3'],
		['0.0.0', '0.0.0', 'v0.0.0'],
		['10.20.300', '10.20.300', 'v10.20.300'],
	])('parses supported version form %s', (input, version, tag) => {
		expect(parseReleaseVersion(input)).toMatchObject({ version, tag });
	});

	test.each([
		'',
		'1',
		'1.2',
		'1.2.3.4',
		'V1.2.3',
		'01.2.3',
		'1.02.3',
		'1.2.03',
		'1.2.3-beta',
		'1.2.3+build',
		' 1.2.3',
		'https://example.test/1.2.3',
		'9007199254740992.0.0',
	])('rejects malformed or unsupported version %s', (input) => {
		expect(() => parseReleaseVersion(input)).toThrow();
	});

	test.each([
		['1.2.3', '1.2.4', -1],
		['v1.10.0', '1.9.9', 1],
		['2.0.0', 'v1.99.99', 1],
		['v1.2.3', '1.2.3', 0],
	])('compares %s against %s', (left, right, direction) => {
		expect(Math.sign(compareReleaseVersions(left, right))).toBe(direction);
	});

	test.each([
		['darwin', 'x64', 'otto-darwin-x64'],
		['darwin', 'arm64', 'otto-darwin-arm64'],
		['linux', 'x64', 'otto-linux-x64'],
		['linux', 'arm64', 'otto-linux-arm64'],
		['win32', 'x64', 'otto-windows-x64.exe'],
		['win32', 'arm64', 'otto-windows-arm64.exe'],
	])('selects %s/%s asset', (platform, architecture, asset) => {
		expect(getReleaseAssetName(platform, architecture)).toBe(asset);
		expect(getOfficialReleaseUrl('v1.2.3', platform, architecture)).toBe(
			`https://github.com/nitishxyz/otto/releases/download/v1.2.3/${asset}`,
		);
	});

	test.each([
		['freebsd', 'x64'],
		['linux', 'ia32'],
		['aix', 'ppc64'],
	])('rejects unsupported release target %s/%s', (platform, architecture) => {
		expect(() => getReleaseAssetName(platform, architecture)).toThrow(
			'Unsupported release platform',
		);
	});
});
