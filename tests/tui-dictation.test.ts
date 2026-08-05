import { describe, expect, test } from 'bun:test';
import {
	calculateFloat32Level,
	float32ToPcm16,
} from '../apps/tui/src/dictation/recorder.ts';
import { appendDictationTranscript } from '../apps/tui/src/lib/dictation-text.ts';

describe('TUI dictation', () => {
	test('calculates a responsive display level from native float PCM', () => {
		expect(calculateFloat32Level(new Float32Array([0, 0]))).toBe(0.03);
		expect(calculateFloat32Level(new Float32Array([0.5, -0.5]))).toBe(0.95);
	});

	test('converts native float PCM to server-ready pcm_s16le', () => {
		const bytes = float32ToPcm16(new Float32Array([0.5, -0.5, 2, -2]));
		const view = new DataView(bytes.buffer);
		expect(view.getInt16(0, true)).toBe(16_383);
		expect(view.getInt16(2, true)).toBe(-16_384);
		expect(view.getInt16(4, true)).toBe(32_767);
		expect(view.getInt16(6, true)).toBe(-32_768);
	});

	test('keeps dictated Markdown lists separate from an existing draft', () => {
		expect(
			appendDictationTranscript('Please update this', '- one\n- two'),
		).toBe('Please update this\n\n- one\n- two');
	});
});
