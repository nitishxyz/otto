import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	getGlobalDebugLogPath,
	getSessionDebugDetailsLogPath,
	getSessionDebugLogPath,
} from '../../../../config/src/paths.ts';
import { isDebugEnabled } from '../debug.ts';
import { serializeLogMeta } from './format.ts';

function getDebugLogFilePath(): string | undefined {
	if (!isDebugEnabled()) return undefined;
	return getGlobalDebugLogPath();
}

function getSessionLogFilePath(
	meta?: Record<string, unknown>,
): string | undefined {
	if (!isDebugEnabled()) return undefined;
	if (meta?.debugDetail === true) return undefined;
	const sessionId = meta?.sessionId;
	if (typeof sessionId !== 'string' || !sessionId.trim()) return undefined;
	return getSessionDebugLogPath(sessionId);
}

function getSessionDetailsLogFilePath(
	meta?: Record<string, unknown>,
): string | undefined {
	if (!isDebugEnabled()) return undefined;
	const sessionId = meta?.sessionId;
	if (typeof sessionId !== 'string' || !sessionId.trim()) return undefined;
	return getSessionDebugDetailsLogPath(sessionId);
}

function appendLogFile(filePath: string, fullLine: string): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		appendFileSync(filePath, `${fullLine}\n`, 'utf-8');
	} catch {
		// ignore file logging errors
	}
}

export function writeLogLine(
	line: string,
	meta?: Record<string, unknown>,
): string {
	const suffix = serializeLogMeta(meta);
	const fullLine = `${new Date().toISOString()} ${line}${suffix}`;
	const logFile = getDebugLogFilePath();

	if (logFile) appendLogFile(logFile, fullLine);

	const sessionLogFile = getSessionLogFilePath(meta);
	if (sessionLogFile) appendLogFile(sessionLogFile, fullLine);

	const sessionDetailsLogFile = getSessionDetailsLogFilePath(meta);
	if (sessionDetailsLogFile) appendLogFile(sessionDetailsLogFile, fullLine);

	return fullLine;
}
