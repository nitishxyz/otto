import { describe, expect, test } from 'bun:test';
import {
	drawTerminalCursor,
	mapGhosttyCursorVisualStyle,
	resolveTerminalCursorDisplay,
	resolveTerminalCursorShape,
	terminalCursorCellRect,
} from '../packages/web-sdk/src/lib/terminal-cursor';

describe('resolveTerminalCursorDisplay', () => {
	test('hides the cursor when the model reports it invisible', () => {
		expect(
			resolveTerminalCursorDisplay({
				focused: true,
				modelVisible: false,
				modelBlinking: true,
				blinkPhaseVisible: true,
			}),
		).toBe('hidden');
	});

	test('uses a steady hollow block while unfocused', () => {
		expect(
			resolveTerminalCursorDisplay({
				focused: false,
				modelVisible: true,
				modelBlinking: true,
				blinkPhaseVisible: false,
			}),
		).toBe('hollow');
	});

	test('blinks across repeated focused phases without sticking hidden', () => {
		const phases = [true, false, true, false, true, false, true];
		const displays = phases.map((blinkPhaseVisible) =>
			resolveTerminalCursorDisplay({
				focused: true,
				modelVisible: true,
				modelBlinking: true,
				blinkPhaseVisible,
			}),
		);
		expect(displays).toEqual([
			'solid',
			'hidden',
			'solid',
			'hidden',
			'solid',
			'hidden',
			'solid',
		]);
		// Never collapses to a permanent hollow/blank while focused.
		expect(displays.every((d) => d === 'solid' || d === 'hidden')).toBe(true);
		expect(displays.filter((d) => d === 'solid').length).toBeGreaterThan(2);
	});

	test('stays solid while focused when the model disables blinking', () => {
		expect(
			resolveTerminalCursorDisplay({
				focused: true,
				modelVisible: true,
				modelBlinking: false,
				blinkPhaseVisible: false,
			}),
		).toBe('solid');
	});
});

describe('resolveTerminalCursorShape', () => {
	test('forces bordered block on blur regardless of terminal style', () => {
		expect(resolveTerminalCursorShape('hollow', 'bar')).toBe('blockHollow');
		expect(resolveTerminalCursorShape('hollow', 'underline')).toBe(
			'blockHollow',
		);
		expect(resolveTerminalCursorShape('hollow', 'block')).toBe('blockHollow');
	});

	test('preserves bar/underline/block while focused and solid', () => {
		expect(resolveTerminalCursorShape('solid', 'bar')).toBe('bar');
		expect(resolveTerminalCursorShape('solid', 'underline')).toBe('underline');
		expect(resolveTerminalCursorShape('solid', 'block')).toBe('block');
	});

	test('returns null when the display is hidden', () => {
		expect(resolveTerminalCursorShape('hidden', 'block')).toBeNull();
	});
});

describe('mapGhosttyCursorVisualStyle', () => {
	test('maps official ghostty-vt visual style enum values', () => {
		expect(mapGhosttyCursorVisualStyle(0)).toBe('bar');
		expect(mapGhosttyCursorVisualStyle(1)).toBe('block');
		expect(mapGhosttyCursorVisualStyle(2)).toBe('underline');
		expect(mapGhosttyCursorVisualStyle(3)).toBe('blockHollow');
		expect(mapGhosttyCursorVisualStyle(99)).toBe('block');
	});
});

describe('terminalCursorCellRect + drawTerminalCursor', () => {
	test('computes cell geometry from grid metrics', () => {
		expect(terminalCursorCellRect(3, 2, 8, 16)).toEqual({
			x: 24,
			y: 32,
			width: 8,
			height: 16,
		});
	});

	test('draws a hollow outline for the unfocused bordered block', () => {
		const calls: string[] = [];
		const ctx = {
			fillStyle: '',
			strokeStyle: '',
			globalAlpha: 1,
			fillRect(...args: number[]) {
				calls.push(`fill:${args.join(',')}`);
			},
			strokeRect(...args: number[]) {
				calls.push(`stroke:${args.join(',')}`);
			},
		};
		drawTerminalCursor(ctx, {
			shape: 'blockHollow',
			color: '#ffffff',
			rect: { x: 10, y: 20, width: 8, height: 16 },
		});
		expect(ctx.strokeStyle).toBe('#ffffff');
		expect(calls).toEqual(['stroke:10.5,20.5,7,15']);
	});

	test('draws solid block/bar/underline shapes while focused', () => {
		const calls: string[] = [];
		const ctx = {
			fillStyle: '',
			strokeStyle: '',
			globalAlpha: 1,
			fillRect(...args: number[]) {
				calls.push(`fill:${args.join(',')}`);
			},
			strokeRect(...args: number[]) {
				calls.push(`stroke:${args.join(',')}`);
			},
		};
		drawTerminalCursor(ctx, {
			shape: 'bar',
			color: '#fff',
			rect: { x: 0, y: 0, width: 10, height: 20 },
		});
		drawTerminalCursor(ctx, {
			shape: 'underline',
			color: '#fff',
			rect: { x: 0, y: 0, width: 10, height: 20 },
		});
		drawTerminalCursor(ctx, {
			shape: 'block',
			color: '#fff',
			rect: { x: 0, y: 0, width: 10, height: 20 },
		});
		expect(calls.some((c) => c.startsWith('fill:0,0,2,20'))).toBe(true);
		expect(calls.some((c) => c.startsWith('fill:0,17,10,3'))).toBe(true);
		expect(calls.some((c) => c.startsWith('fill:0,0,10,20'))).toBe(true);
	});
});
