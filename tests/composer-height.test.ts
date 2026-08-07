import { describe, expect, test } from 'bun:test';
import {
	COMPOSER_BASE_HEIGHT,
	resolveComposerHeight,
} from '../packages/web-sdk/src/components/chat/composerHeight';

describe('composer autosize height', () => {
	test('an empty composer always rests at the single-row height', () => {
		// Regression: a pre-layout measurement in a narrow window reported a
		// full-viewport scrollHeight and stayed pinned until the user typed.
		expect(resolveComposerHeight({ value: '', scrollHeight: 640 })).toBe(
			COMPOSER_BASE_HEIGHT,
		);
		expect(resolveComposerHeight({ value: '', scrollHeight: 40 })).toBe(
			COMPOSER_BASE_HEIGHT,
		);
	});

	test('a filled composer grows to its measured content height', () => {
		expect(resolveComposerHeight({ value: 'hi', scrollHeight: 40 })).toBe(
			'40px',
		);
		expect(
			resolveComposerHeight({ value: 'a\nb\nc\nd', scrollHeight: 120 }),
		).toBe('120px');
	});

	test('unmeasurable elements fall back to the base height', () => {
		expect(resolveComposerHeight({ value: 'hi', scrollHeight: 0 })).toBe(
			COMPOSER_BASE_HEIGHT,
		);
		expect(resolveComposerHeight({ value: 'hi', scrollHeight: -1 })).toBe(
			COMPOSER_BASE_HEIGHT,
		);
		expect(
			resolveComposerHeight({ value: 'hi', scrollHeight: Number.NaN }),
		).toBe(COMPOSER_BASE_HEIGHT);
	});
});

describe('chat input autosize wiring', () => {
	test('measures before paint and re-measures when the composer width changes', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/chat/ChatInput.tsx',
		).text();
		expect(source).toContain('resolveComposerHeight({');
		expect(source).toContain(
			'}, [adjustTextareaHeight, message, footerWidth, isVoiceActive]);',
		);
		// The raw scrollHeight must no longer be written straight to the element.
		expect(source).not.toContain(
			['textarea.style.height = `', '{textarea.scrollHeight}px`;'].join('$'),
		);
	});
});

describe('live waveform idle loop', () => {
	test('stops the animation frame loop once there is nothing to draw', async () => {
		const source = await Bun.file(
			'packages/web-sdk/src/components/chat/LiveWaveform.tsx',
		).text();
		expect(source).toContain(
			'if (!active && !loading && historyRef.current.length === 0) {',
		);
	});
});
