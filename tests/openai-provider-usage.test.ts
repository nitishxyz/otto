import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test';
import { fetchOpenAIUsage } from '../packages/server/src/routes/provider-usage/fetchers.ts';

const fetchSpy = spyOn(globalThis, 'fetch');
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

describe('OpenAI credits usage', () => {
	test.each([
		[12.34, 12.34],
		['12.34', 12.34],
		[0, 0],
		['0', 0],
		[null, null],
		[undefined, null],
		['', null],
		['   ', null],
		['invalid', null],
		['Infinity', null],
		[true, null],
		[{}, null],
	])('normalizes balance %j to %j', async (balance, expected) => {
		fetchSpy.mockResolvedValue(
			Response.json({ credits: { has_credits: true, balance } }),
		);
		const usage = await fetchOpenAIUsage('test-access');
		expect(usage.credits).toEqual({ has_credits: true, balance: expected });
		if (usage.credits?.balance !== null) {
			expect(() => usage.credits?.balance?.toFixed(2)).not.toThrow();
		}
	});

	test('preserves absent credits', async () => {
		fetchSpy.mockResolvedValue(Response.json({}));
		const usage = await fetchOpenAIUsage('test-access');
		expect(usage.credits).toBeNull();
	});

	test('preserves credit availability and the raw response', async () => {
		const data = { credits: { has_credits: false, balance: '0' } };
		fetchSpy.mockResolvedValue(Response.json(data));
		const usage = await fetchOpenAIUsage('test-access');
		expect(usage.credits).toEqual({ has_credits: false, balance: 0 });
		expect(usage.raw).toEqual(data);
	});
});
