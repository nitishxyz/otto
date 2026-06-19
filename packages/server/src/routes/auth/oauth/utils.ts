export function parseXaiAuthorizationCode(input: string): string {
	const trimmed = input.trim().replace(/^['"]|['"]$/g, '');
	try {
		const url = new URL(trimmed);
		return url.searchParams.get('code') || trimmed;
	} catch {}

	try {
		const params = new URLSearchParams(
			trimmed.startsWith('?') ? trimmed.slice(1) : trimmed,
		);
		return params.get('code') || trimmed;
	} catch {}

	return trimmed;
}

export function closeOAuthCallback(close: (() => void) | undefined): void {
	try {
		close?.();
	} catch {}
}

export function oauthSuccessHtml(provider: string): string {
	return `
		<html>
			<head>
				<title>Connected!</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
					.container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
					.checkmark { font-size: 4rem; margin-bottom: 1rem; }
					h1 { margin: 0 0 0.5rem 0; }
					p { margin: 0; opacity: 0.9; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="checkmark">✓</div>
					<h1>Connected!</h1>
					<p>You can close this window.</p>
				</div>
				<script>
					if (window.opener) window.opener.postMessage({ type: 'oauth-success', provider: '${provider}' }, '*');
					setTimeout(() => window.close(), 1500);
				</script>
			</body>
		</html>
	`;
}

export function oauthErrorHtml(provider: string, message: string): string {
	return `
		<html>
			<head>
				<title>Error</title>
				<style>
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; }
					.container { text-align: center; padding: 2rem; background: rgba(255,255,255,0.1); border-radius: 16px; backdrop-filter: blur(10px); }
					.icon { font-size: 4rem; margin-bottom: 1rem; }
					h1 { margin: 0 0 0.5rem 0; }
					p { margin: 0; opacity: 0.9; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="icon">✗</div>
					<h1>Error</h1>
					<p>${message}</p>
				</div>
				<script>
					if (window.opener) window.opener.postMessage({ type: 'oauth-error', provider: '${provider}', error: '${message}' }, '*');
					setTimeout(() => window.close(), 3000);
				</script>
			</body>
		</html>
	`;
}

export function oauthExpiredHtml(): string {
	return '<html><body><h1>Session expired</h1><p>Please close this window and try again.</p><script>setTimeout(() => window.close(), 3000);</script></body></html>';
}
