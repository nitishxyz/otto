import { describe, expect, test } from 'bun:test';
import { appendDictationTranscript } from '../packages/web-sdk/src/lib/dictation-text.ts';

describe('appendDictationTranscript', () => {
	test('keeps plain dictation inline with an existing draft', () => {
		expect(appendDictationTranscript('Please', 'review this.')).toBe(
			'Please review this.',
		);
	});

	test('starts formatted lists on a new Markdown block', () => {
		expect(
			appendDictationTranscript('Tasks:', '- add tests\n- update docs'),
		).toBe('Tasks:\n\n- add tests\n- update docs');
		expect(appendDictationTranscript('Steps: ', '1. install\n2. test')).toBe(
			'Steps:\n\n1. install\n2. test',
		);
	});

	test('handles empty drafts and transcripts', () => {
		expect(appendDictationTranscript('', '- add tests')).toBe('- add tests');
		expect(appendDictationTranscript('Existing text', '')).toBe(
			'Existing text',
		);
	});
});
