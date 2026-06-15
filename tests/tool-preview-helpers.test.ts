import { describe, expect, test } from 'bun:test';
import { extractStreamingMultiEditPreviewEdits } from '../packages/web-sdk/src/hooks/tool-preview-helpers.ts';

describe('tool preview helpers', () => {
	test('extracts multiedit edits from complete streamed JSON input', () => {
		const buffer = JSON.stringify({
			path: 'src/app.ts',
			edits: [
				{ oldString: 'const a = 1;', newString: 'const a = 2;' },
				{ oldString: 'return a;', newString: 'return a + 1;' },
			],
		});

		expect(extractStreamingMultiEditPreviewEdits(buffer)).toEqual([
			{ oldString: 'const a = 1;', newString: 'const a = 2;' },
			{ oldString: 'return a;', newString: 'return a + 1;' },
		]);
	});

	test('extracts a partial newString while multiedit input is streaming', () => {
		const buffer =
			'{"path":"src/app.ts","edits":[{"oldString":"hello\\nworld","newString":"hello\\nstream';

		expect(extractStreamingMultiEditPreviewEdits(buffer)).toEqual([
			{ oldString: 'hello\nworld', newString: 'hello\nstream' },
		]);
	});

	test('waits until oldString is closed before building a streaming edit', () => {
		const buffer = '{"path":"src/app.ts","edits":[{"oldString":"hello\\nwor';

		expect(extractStreamingMultiEditPreviewEdits(buffer)).toEqual([]);
	});
});
