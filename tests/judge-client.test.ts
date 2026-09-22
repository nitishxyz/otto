import { afterEach, describe, expect, test } from 'bun:test';
import {
	JudgeClient,
	createJudgeFromConfig,
	choice,
	noul,
	score,
	resolveJudgeConfig,
	type JudgeFetch,
	type ResolvedJudgeConfig,
} from '../packages/sdk/src/judge/index.ts';

const originalEnv = process.env.TYPESAFE_API_KEY;

afterEach(() => {
	if (originalEnv === undefined) delete process.env.TYPESAFE_API_KEY;
	else process.env.TYPESAFE_API_KEY = originalEnv;
});

function config(
	overrides: Partial<ResolvedJudgeConfig> = {},
): ResolvedJudgeConfig {
	return {
		enabled: true,
		provider: 'typesafe',
		baseURL: 'https://judge.example',
		model: 'jev-test',
		apiKey: 'key',
		timeoutMs: 500,
		mcp: { classifyTools: true, preloadTools: true, preloadThreshold: 0.5 },
		...overrides,
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

describe('judge config', () => {
	test('is unavailable without credentials and never throws', async () => {
		delete process.env.TYPESAFE_API_KEY;
		const resolved = await resolveJudgeConfig(undefined, '/nonexistent');
		expect(resolved.enabled).toBe(true);
		expect(resolved.baseURL).toBe('https://api.typesafe.ai');
		expect(createJudgeFromConfig(resolved)).toBeNull();
	});

	test('reads env key and honors overrides', async () => {
		process.env.TYPESAFE_API_KEY = 'env-key';
		const resolved = await resolveJudgeConfig(
			{
				baseURL: 'https://self-hosted.example/',
				model: 'jev-custom',
				mcp: { preloadThreshold: 1.7, classifyTools: false },
			},
			'/nonexistent',
		);
		expect(resolved.apiKey).toBe('env-key');
		expect(resolved.baseURL).toBe('https://self-hosted.example');
		expect(resolved.model).toBe('jev-custom');
		expect(resolved.mcp.preloadThreshold).toBe(1);
		expect(resolved.mcp.classifyTools).toBe(false);
		expect(createJudgeFromConfig(resolved)).not.toBeNull();
	});

	test('enabled=false disables even with a key', async () => {
		process.env.TYPESAFE_API_KEY = 'env-key';
		const resolved = await resolveJudgeConfig({ enabled: false });
		expect(createJudgeFromConfig(resolved)).toBeNull();
	});
});

describe('JudgeClient', () => {
	test('posts state and questions and returns typed answers', async () => {
		let captured: { url: string; init: RequestInit } | undefined;
		const fetchImpl: JudgeFetch = async (url, init) => {
			captured = { url, init };
			return jsonResponse({
				model: 'jev-test',
				answers: {
					urgent: { type: 'noul', noul: 0.91 },
					team: {
						type: 'choice',
						choice: 'billing',
						probabilities: { billing: 0.8, technical: 0.2 },
						confidence: 0.77,
					},
					mood: {
						type: 'score',
						score: 1.4,
						legend: { '0': 'calm', '1': 'annoyed', '2': 'angry' },
						probabilities: { '0': 0.1, '1': 0.4, '2': 0.5 },
						confidence: 0.6,
					},
				},
				usage: { input_tokens: 10, output_tokens: 3 },
			});
		};
		const client = new JudgeClient(config(), fetchImpl);
		const result = await client.judge({
			state: { text: 'charged twice' },
			questions: {
				urgent: noul('Is it urgent?'),
				team: choice('Which team?', { billing: null, technical: null }),
				mood: score('Mood?', ['calm', 'annoyed', 'angry']),
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.answers.urgent.noul).toBe(0.91);
		expect(result.answers.team.choice).toBe('billing');
		expect(result.answers.mood.score).toBe(1.4);
		expect(result.usage?.input_tokens).toBe(10);

		expect(captured?.url).toBe('https://judge.example/v1/systemone');
		const headers = captured?.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer key');
		const body = JSON.parse(String(captured?.init.body));
		expect(body.model).toBe('jev-test');
		expect(body.state).toEqual({ text: 'charged twice' });
		expect(body.questions.team.type).toBe('choice');
	});

	test('returns unconfigured/disabled without calling fetch', async () => {
		let calls = 0;
		const fetchImpl: JudgeFetch = async () => {
			calls++;
			return jsonResponse({});
		};
		const noKey = new JudgeClient(config({ apiKey: undefined }), fetchImpl);
		const disabled = new JudgeClient(config({ enabled: false }), fetchImpl);
		const q = { x: noul('?') };
		expect(await noKey.judge({ state: 's', questions: q })).toEqual({
			ok: false,
			reason: 'unconfigured',
		});
		expect(await disabled.judge({ state: 's', questions: q })).toEqual({
			ok: false,
			reason: 'disabled',
		});
		expect(calls).toBe(0);
	});

	test('reports HTTP errors and retries once on 429', async () => {
		let calls = 0;
		const fetchImpl: JudgeFetch = async () => {
			calls++;
			if (calls === 1) return jsonResponse({ error: 'slow down' }, 429);
			return jsonResponse({
				answers: { x: { type: 'noul', noul: 0.2 } },
			});
		};
		const client = new JudgeClient(config(), fetchImpl);
		const result = await client.judge({
			state: 's',
			questions: { x: noul('?') },
		});
		expect(result.ok).toBe(true);
		expect(calls).toBe(2);

		const failing = new JudgeClient(config(), async () =>
			jsonResponse({ error: 'bad key' }, 401),
		);
		const failed = await failing.judge({
			state: 's',
			questions: { x: noul('?') },
		});
		expect(failed).toMatchObject({ ok: false, reason: 'error' });
	});

	test('rejects malformed answers', async () => {
		const client = new JudgeClient(config(), async () =>
			jsonResponse({ answers: { x: { type: 'choice', choice: 'a' } } }),
		);
		const result = await client.judge({
			state: 's',
			questions: { x: noul('?') },
		});
		expect(result).toMatchObject({ ok: false, reason: 'error' });
	});

	test('times out and never throws', async () => {
		const fetchImpl: JudgeFetch = (_url, init) =>
			new Promise((_resolve, reject) => {
				init.signal?.addEventListener('abort', () =>
					reject(new DOMException('Aborted', 'AbortError')),
				);
			});
		const client = new JudgeClient(config({ timeoutMs: 20 }), fetchImpl);
		const result = await client.judge({
			state: 's',
			questions: { x: noul('?') },
		});
		expect(result).toEqual({ ok: false, reason: 'timeout' });
	});
});
