import { tool } from 'ai';
import { z } from 'zod/v3';
import DESCRIPTION from './progress.txt' with { type: 'text' };

// Progress update tool: allows the model to emit lightweight status signals
// without revealing chain-of-thought. The runner/UI should surface these
// messages immediately.
const StageEnum = z.enum([
	'planning',
	'discovering',
	'generating',
	'preparing',
	'writing',
	'verifying',
]);

export const progressUpdateTool = tool({
	description: DESCRIPTION,
	inputSchema: z.object({
		message: z
			.string()
			.min(1)
			.max(200)
			.describe('Short, user-facing status message (<= 200 chars).'),
		pct: z
			.number()
			.min(0)
			.max(100)
			.optional()
			.describe('Optional overall progress percent 0-100.'),
		stage: StageEnum.optional().default('planning'),
	}),
	async execute() {
		// Keep the tool lightweight; no side effects beyond the event itself.
		return { ok: true } as const;
	},
});
