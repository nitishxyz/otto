import { describe, expect, test } from 'bun:test';
import { CircularBuffer } from '../packages/sdk/src/core/src/terminals/circular-buffer.ts';

describe('terminal circular buffer', () => {
	test('retains recent output within both chunk and byte limits', () => {
		const buffer = new CircularBuffer(3, 9);

		buffer.push('one');
		buffer.push('two');
		buffer.push('three');

		expect(buffer.read()).toEqual(['two', 'three']);

		buffer.push('four');
		expect(buffer.read()).toEqual(['three', 'four']);
	});

	test('accounts for UTF-8 bytes and resets retention on clear', () => {
		const buffer = new CircularBuffer(10, 5);

		buffer.push('éé');
		buffer.push('ab');
		expect(buffer.read()).toEqual(['ab']);

		buffer.clear();
		buffer.push('12345');
		expect(buffer.read()).toEqual(['12345']);
	});
});
