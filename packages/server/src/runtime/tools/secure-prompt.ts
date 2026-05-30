const ANSI_PATTERN = String.raw`[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]`;
const CONTROL_PATTERN = String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`;
const ANSI_RE = new RegExp(ANSI_PATTERN, 'g');
const CONTROL_RE = new RegExp(CONTROL_PATTERN, 'g');
const SECURE_PROMPT_PATTERNS = [
	/\[sudo\]\s+password\s+for\s+[^:\r\n]+:\s*$/i,
	/(?:^|[\r\n])password(?:\s+for\s+[^:\r\n]+)?:\s*$/i,
	/enter\s+(?:password|passphrase)(?:\s+for\s+[^:\r\n]+)?:\s*$/i,
	/passphrase\s+for\s+(?:key\s+)?["'][^"']+["']:\s*$/i,
];

export function cleanPromptOutput(raw: string): string {
	return raw
		.replace(ANSI_RE, '')
		.replace(CONTROL_RE, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
}

export function detectSecurePrompt(raw: string): string | null {
	const cleaned = cleanPromptOutput(raw).slice(-500);
	if (!SECURE_PROMPT_PATTERNS.some((pattern) => pattern.test(cleaned))) {
		return null;
	}

	const lines = cleaned.split('\n');
	return lines[lines.length - 1]?.trim() || 'Password required';
}

export function normalizeSudoCommand(cmd: string): string {
	if (process.platform === 'win32') return cmd;
	const trimmedStart = cmd.match(/^\s*/)?.[0] ?? '';
	const rest = cmd.slice(trimmedStart.length);
	if (!rest.startsWith('sudo ')) return cmd;
	if (/^sudo\s+(?:-[^\s]*S[^\s]*\s|.*\s-S(?:\s|$))/.test(rest)) return cmd;
	return `${trimmedStart}sudo -S -p "[sudo] password for %u: " ${rest.slice(5)}`;
}
