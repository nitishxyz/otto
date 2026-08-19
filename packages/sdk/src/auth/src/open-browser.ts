import { spawn } from 'node:child_process';

export type BrowserCommand = {
	command: string;
	args: string[];
};

export function getBrowserCommand(
	url: string,
	platform: NodeJS.Platform = process.platform,
): BrowserCommand {
	switch (platform) {
		case 'darwin':
			return { command: 'open', args: [url] };
		case 'win32':
			return {
				command: 'rundll32.exe',
				args: ['url.dll,FileProtocolHandler', url],
			};
		default:
			return { command: 'xdg-open', args: [url] };
	}
}

export async function openBrowser(url: string): Promise<void> {
	const { command, args } = getBrowserCommand(url);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { shell: false });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Failed to open browser (exit code ${code})`));
		});
	});
}
