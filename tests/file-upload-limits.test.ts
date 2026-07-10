import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_MAX_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_SIZE_MB,
	validateStagedFile,
} from '../packages/web-sdk/src/hooks/useFileUpload';

const MB = 1024 * 1024;

function fakeFile(name: string, sizeBytes: number): File {
	return { name, size: sizeBytes } as File;
}

const limits = {
	maxSizeMB: DEFAULT_MAX_FILE_SIZE_MB,
	maxTotalSizeMB: DEFAULT_MAX_TOTAL_SIZE_MB,
};

describe('validateStagedFile', () => {
	test('defaults are 5MB per file and 20MB total', () => {
		expect(DEFAULT_MAX_FILE_SIZE_MB).toBe(5);
		expect(DEFAULT_MAX_TOTAL_SIZE_MB).toBe(20);
	});

	test('accepts a file within both limits', () => {
		const result = validateStagedFile(fakeFile('a.txt', 4 * MB), 0, limits);
		expect(result.ok).toBe(true);
	});

	test('rejects a file over the per-file limit and names it', () => {
		const result = validateStagedFile(fakeFile('big.bin', 6 * MB), 0, limits);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected rejection');
		expect(result.reason).toBe('file');
		expect(result.message).toContain('big.bin');
		expect(result.message).toContain('Max per file: 5MB');
	});

	test('rejects a file that pushes staged total over the aggregate limit', () => {
		const result = validateStagedFile(
			fakeFile('c.txt', 4 * MB),
			18 * MB,
			limits,
		);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected rejection');
		expect(result.reason).toBe('total');
		expect(result.message).toContain('c.txt');
		expect(result.message).toContain('20MB total');
	});

	test('allows a file that exactly fills the aggregate limit', () => {
		const result = validateStagedFile(
			fakeFile('d.txt', 2 * MB),
			18 * MB,
			limits,
		);
		expect(result.ok).toBe(true);
	});
});
