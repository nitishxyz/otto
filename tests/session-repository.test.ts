import { describe, expect, test } from 'bun:test';
import type { DB } from '@ottocode/database';
import {
	SessionNotFoundError,
	SessionProjectMismatchError,
	SessionRepository,
	type SessionRow,
} from '../packages/server/src/runtime/session/repository.ts';

function databaseReturning(rows: SessionRow[]): DB {
	return {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => rows,
				}),
			}),
		}),
	} as unknown as DB;
}

function session(projectPath: string): SessionRow {
	return { id: 'session-1', projectPath } as SessionRow;
}

describe('SessionRepository ownership', () => {
	test('returns sessions owned by the resolved project', async () => {
		const row = session('/projects/alpha');
		const repository = new SessionRepository(
			databaseReturning([row]),
			'/projects/alpha',
		);

		expect(await repository.require(row.id)).toBe(row);
	});

	test('uses the canonical not-found error for missing sessions', async () => {
		const repository = new SessionRepository(
			databaseReturning([]),
			'/projects/alpha',
		);

		await expect(repository.require('missing')).rejects.toMatchObject({
			name: 'SessionNotFoundError',
			status: 404,
			code: 'session_not_found',
			message: 'Session not found',
		});
		expect(new SessionNotFoundError('missing').status).toBe(404);
	});

	test('rejects cross-project rows with a non-disclosing 404', async () => {
		const repository = new SessionRepository(
			databaseReturning([session('/projects/beta')]),
			'/projects/alpha',
		);

		await expect(repository.require('session-1')).rejects.toMatchObject({
			name: 'SessionProjectMismatchError',
			status: 404,
			code: 'session_project_mismatch',
			message: 'Session not found',
		});
		expect(
			new SessionProjectMismatchError('session-1', '/projects/alpha').status,
		).toBe(404);
	});
});
