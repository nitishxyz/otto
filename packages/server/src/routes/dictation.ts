import type { Hono } from 'hono';
import { registerDictationModelRoutes } from './dictation/models.ts';
import { registerDictationSessionRoutes } from './dictation/sessions.ts';

export function registerDictationRoutes(app: Hono) {
	registerDictationModelRoutes(app);
	registerDictationSessionRoutes(app);
}
