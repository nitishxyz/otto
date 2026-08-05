import { describe, expect, test } from 'bun:test';
import { formatDictationTranscript } from '../packages/server/src/dictation/format.ts';

describe('formatDictationTranscript', () => {
	test('turns explicit bullet commands into a Markdown list', () => {
		expect(
			formatDictationTranscript(
				'Bullet point add tests. Bullet point update the documentation.',
			),
		).toBe('- add tests.\n- update the documentation.');
	});

	test('turns explicit numbered commands into a Markdown list', () => {
		expect(
			formatDictationTranscript(
				'Number one install dependencies. Number two run the tests.',
			),
		).toBe('1. install dependencies.\n2. run the tests.');
	});

	test('formats clear ordinal sequences as an ordered list', () => {
		expect(
			formatDictationTranscript(
				'First, install dependencies. Second, run the tests. Finally, ship it.',
			),
		).toBe('1. install dependencies.\n2. run the tests.\n3. ship it.');
	});

	test('applies spoken paragraph and line breaks', () => {
		expect(
			formatDictationTranscript(
				'Here is the summary. New paragraph Details follow. New line Done.',
			),
		).toBe('Here is the summary.\n\nDetails follow.\nDone.');
	});

	test('leaves incidental ordinal words alone', () => {
		const transcript =
			'This is the first attempt. The second attempt should stay prose.';
		expect(formatDictationTranscript(transcript)).toBe(transcript);
	});

	test('does not treat layout phrases inside ordinary prose as commands', () => {
		const transcript =
			'Add a new line handler and use a bullet point icon for item one and item two.';
		expect(formatDictationTranscript(transcript)).toBe(transcript);
		expect(formatDictationTranscript('New line handlers stay readable.')).toBe(
			'New line handlers stay readable.',
		);
	});

	test('requires punctuation for automatically detected ordinal lists', () => {
		const transcript = 'First attempt failed. Second attempt worked.';
		expect(formatDictationTranscript(transcript)).toBe(transcript);
	});

	test('accepts comma-separated explicit bullet commands', () => {
		expect(
			formatDictationTranscript(
				'Bullet point add tests, bullet point update the docs.',
			),
		).toBe('- add tests\n- update the docs.');
	});

	test('formats a natural counted list from the reported transcript', () => {
		const transcript =
			"This is Mr. Test for dictation. Let's see how formatting works. There are three things that we have to check. Formatting is working, multilingual, keywords are all set, and the final test is where the UI for setting custom edu works and removing the old keywords.";
		expect(formatDictationTranscript(transcript)).toBe(
			"This is Mr. Test for dictation. Let's see how formatting works. There are three things that we have to check:\n\n- Formatting is working\n- multilingual\n- keywords are all set\n- the final test is where the UI for setting custom edu works and removing the old keywords",
		);
	});
});
