import type { Hono } from 'hono';
import {
	getPendingSecureInput,
	getPendingSecureInputsForSession,
	resolveSecureInput,
} from '../runtime/tools/secure-input.ts';

export function registerSessionSecureInputRoute(app: Hono) {
	app.post('/v1/sessions/:id/secure-input', async (c) => {
		const sessionId = c.req.param('id');
		let body: {
			promptId?: unknown;
			value?: unknown;
			cancelled?: unknown;
		};

		try {
			body = await c.req.json();
		} catch {
			return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
		}

		if (typeof body.promptId !== 'string') {
			return c.json({ ok: false, error: 'promptId is required' }, 400);
		}

		const pending = getPendingSecureInput(body.promptId);
		if (!pending) {
			return c.json(
				{ ok: false, error: 'No pending secure input found for this promptId' },
				404,
			);
		}

		if (pending.sessionId !== sessionId) {
			return c.json(
				{ ok: false, error: 'Secure input does not belong to this session' },
				403,
			);
		}

		const value = body.cancelled === true ? null : String(body.value ?? '');
		const result = resolveSecureInput(body.promptId, value);
		if (!result.ok) {
			return c.json({ ok: false, error: result.error }, 400);
		}

		return c.json({
			ok: true,
			promptId: body.promptId,
			cancelled: value === null,
		});
	});

	app.get('/v1/sessions/:id/secure-input/pending', (c) => {
		const sessionId = c.req.param('id');
		const pending = getPendingSecureInputsForSession(sessionId).map(
			(input) => ({
				promptId: input.promptId,
				messageId: input.messageId,
				callId: input.callId,
				prompt: input.prompt,
				inputKind: 'password' as const,
				createdAt: input.createdAt,
			}),
		);

		return c.json({ ok: true, pending });
	});
}
