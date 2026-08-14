const ANSI_PATTERN = String.raw`[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]`;
const CONTROL_PATTERN = String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`;
const ANSI_RE = new RegExp(ANSI_PATTERN, 'g');
const CONTROL_RE = new RegExp(CONTROL_PATTERN, 'g');
export type SecureInputKind = 'password' | 'text';

export interface DetectedSecurePrompt {
	prompt: string;
	inputKind: SecureInputKind;
	allowEmpty?: boolean;
}

const PASSWORD_PROMPT_PATTERNS = [
	/\[sudo\]\s+password\s+for\s+[^\r\n]+:\s*$/i,
	/(?:^|[\r\n])password(?:\s+for\s+[^\r\n]+)?:\s*$/i,
	/(?:^|[\r\n])passphrase(?:\s+for\s+[^\r\n]+)?:\s*$/i,
	/(?:^|[\r\n])password\s+\([^\r\n)]+\):\s*$/i,
	/(?:^|[\r\n])[^\r\n]+['’]s password:\s*$/i,
	/enter\s+(?:password|passphrase|pin)(?:\s+for\s+[^\r\n]+)?:\s*$/i,
	/passphrase\s+for\s+(?:key\s+)?["'][^"']+["']:\s*$/i,
	/(?:personal access|authentication|access) token(?:\s+for\s+[^\r\n]+)?:\s*$/i,
	/(?:verification code|one-time password|otp|pin)(?:\s+for\s+[^\r\n]+)?:\s*$/i,
];

const AUTHENTICATION_FAILURE_PATTERN =
	/(?:permission denied|authentication failed|sorry, try again|bad passphrase|incorrect (?:password|passphrase)|invalid (?:password|passphrase|credentials))/i;

const TEXT_PROMPT_PATTERNS = [
	/(?:^|[\r\n])(?:username|user name|login)(?:\s+for\s+[^\r\n]+)?:\s*$/i,
	/are you sure you want to continue connecting\s*\([^\r\n]+\)\?\s*$/i,
	/\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i,
	/(?:^|[\r\n])[^\r\n]{1,200}(?:\[|\()(?:y\/n|yes\/no)(?:\]|\))\s*:?\s*$/i,
	/(?:^|[\r\n])(?:enter|provide|input|type)\s+(?!password\b|passphrase\b|pin\b|token\b|otp\b)[^\r\n:]{1,120}:\s*$/i,
	/(?:^|[\r\n])(?:select|choose|pick)\s+[^\r\n:]{1,120}:\s*$/i,
	/(?:^|[\r\n])(?:your\s+)?(?:name|email|answer|response|choice|selection|option):\s*$/i,
];

const EMPTY_TEXT_PROMPT_PATTERNS = [
	/(?:^|[\r\n])(?:press|hit)\s+(?:enter|return)(?:\s+[^\r\n]*)?\s*$/i,
	/(?:^|[\r\n])[^\r\n]{1,200}(?:\[|\()(?:default(?:\s*[:=]\s*[^\])]+)?|optional)(?:\]|\))\s*:?\s*$/i,
];

export function cleanPromptOutput(raw: string): string {
	return raw
		.replace(ANSI_RE, '')
		.replace(CONTROL_RE, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n');
}

export function hasAuthenticationFailure(raw: string): boolean {
	return AUTHENTICATION_FAILURE_PATTERN.test(cleanPromptOutput(raw));
}

export function detectSecurePrompt(raw: string): DetectedSecurePrompt | null {
	const cleaned = cleanPromptOutput(raw).slice(-500);
	const allowsEmpty = EMPTY_TEXT_PROMPT_PATTERNS.some((pattern) =>
		pattern.test(cleaned),
	);
	const inputKind = PASSWORD_PROMPT_PATTERNS.some((pattern) =>
		pattern.test(cleaned),
	)
		? 'password'
		: allowsEmpty ||
				TEXT_PROMPT_PATTERNS.some((pattern) => pattern.test(cleaned))
			? 'text'
			: null;
	if (!inputKind) return null;

	const lines = cleaned.split('\n');
	return {
		prompt: lines[lines.length - 1]?.trim() || 'Input required',
		inputKind,
		...(allowsEmpty ? { allowEmpty: true } : {}),
	};
}

export function normalizeSudoCommand(cmd: string): string {
	if (process.platform === 'win32') return cmd;
	const trimmedStart = cmd.match(/^\s*/)?.[0] ?? '';
	const rest = cmd.slice(trimmedStart.length);
	if (!rest.startsWith('sudo ')) return cmd;
	if (/^sudo\s+(?:-[^\s]*S[^\s]*\s|.*\s-S(?:\s|$))/.test(rest)) return cmd;
	return `${trimmedStart}sudo -S -p "[sudo] password for %u: " ${rest.slice(5)}`;
}
