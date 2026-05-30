import { useEffect, useRef, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
	apiClient,
	configureApiClient,
	hasConfiguredRuntimeApiBaseUrl,
	normalizeApiBaseUrl,
	setRuntimeApiBaseUrl,
} from '@ottocode/web-sdk/lib';
import { Loader2, Link2, AlertCircle, ArrowRight } from 'lucide-react';
import { OttoWordmark } from '../components/layout/OttoWordmark';
import { isHostedApp } from '../lib/hosted-app';

export const Route = createFileRoute('/')({
	beforeLoad: () => {
		if (!isHostedApp()) {
			throw redirect({ to: '/sessions' });
		}

		if (!getUrlParam() && hasConfiguredRuntimeApiBaseUrl()) {
			throw redirect({ to: '/sessions' });
		}
	},
	component: ConnectRoute,
});

function getUrlParam() {
	if (typeof window === 'undefined') return '';
	return new URLSearchParams(window.location.search).get('url') ?? '';
}

async function assertReachableApi(baseUrl: string) {
	const response = await fetch(new URL('/openapi.json', baseUrl), {
		method: 'GET',
	});
	if (!response.ok) {
		throw new Error(`otto server responded with ${response.status}`);
	}
}

function ConnectRoute() {
	const navigate = useNavigate();
	const [url, setUrl] = useState(getUrlParam);
	const [error, setError] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const urlParam = getUrlParam();
		if (urlParam) setUrl(urlParam);
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => inputRef.current?.focus(), 60);
		return () => clearTimeout(timer);
	}, []);

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setIsConnecting(true);

		try {
			const baseUrl = normalizeApiBaseUrl(url);
			await assertReachableApi(baseUrl);
			setRuntimeApiBaseUrl(baseUrl);
			configureApiClient();
			await Promise.allSettled([
				apiClient.getConfig(),
				apiClient.getSessions(),
			]);
			await navigate({ to: '/sessions', replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Unable to connect.');
		} finally {
			setIsConnecting(false);
		}
	};

	return (
		<main className="relative flex min-h-[var(--app-height,100dvh)] items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_top,hsl(var(--sidebar-accent)/0.35),transparent_55%),radial-gradient(circle_at_bottom,hsl(var(--accent)/0.25),transparent_60%)]"
			/>

			<section className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl shadow-black/10 backdrop-blur-xl">
				<header className="flex items-center gap-3 border-b border-border/60 px-6 py-5">
					<div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
						<OttoWordmark height={12} />
					</div>
					<div className="min-w-0">
						<p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
							otto
						</p>
						<h1 className="truncate text-base font-semibold tracking-tight text-foreground">
							Connect to a tunnel
						</h1>
					</div>
				</header>

				<div className="space-y-5 px-6 py-6">
					<p className="text-sm leading-6 text-muted-foreground">
						Paste an otto tunnel URL to use this hosted web app with a shared
						local session.
					</p>

					<form className="space-y-4" onSubmit={handleSubmit}>
						<label className="block space-y-1.5">
							<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
								Tunnel URL
							</span>
							<div className="group relative">
								<Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70 transition-colors group-focus-within:text-foreground" />
								<input
									ref={inputRef}
									className="w-full rounded-lg border border-border bg-background px-3 py-2.5 pl-9 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-ring focus:ring-2 focus:ring-ring/20"
									onChange={(event) => setUrl(event.target.value)}
									placeholder="https://your-tunnel.trycloudflare.com"
									type="url"
									value={url}
								/>
							</div>
						</label>

						{error ? (
							<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
								<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span className="leading-relaxed">{error}</span>
							</div>
						) : null}

						<button
							className="group flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isConnecting || !url.trim()}
							type="submit"
						>
							{isConnecting ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									Connecting…
								</>
							) : (
								<>
									Connect
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</>
							)}
						</button>
					</form>

					<p className="border-t border-border/60 pt-4 text-[11px] leading-relaxed text-muted-foreground">
						Tip: links like{' '}
						<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80">
							app.ottocode.io/?url=…
						</code>{' '}
						prefill this field automatically.
					</p>
				</div>
			</section>
		</main>
	);
}
