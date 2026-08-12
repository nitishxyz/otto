import type { TerminalCapabilities } from '@opentui/core';

const MODIFY_OTHER_KEYS_LEVEL_2 = '\x1b[>4;2m';

interface LinuxKeyboardOptions {
	platform?: NodeJS.Platform;
	write?: (sequence: string) => unknown;
}

/** Enables modified-key reporting when Linux falls back from Kitty keyboard. */
export function enableLinuxShiftEnterReporting(
	capabilities: Pick<TerminalCapabilities, 'kitty_keyboard'> | null,
	options: LinuxKeyboardOptions = {},
): boolean {
	const platform = options.platform ?? process.platform;
	if (platform !== 'linux' || capabilities?.kitty_keyboard !== false)
		return false;

	const write =
		options.write ?? ((sequence: string) => process.stdout.write(sequence));
	write(MODIFY_OTHER_KEYS_LEVEL_2);
	return true;
}
