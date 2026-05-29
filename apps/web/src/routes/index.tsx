import { useEffect, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
	apiClient,
	configureApiClient,
	hasConfiguredRuntimeApiBaseUrl,
	normalizeApiBaseUrl,
	setRuntimeApiBaseUrl,
} from '@ottocode/web-sdk/lib';
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

	useEffect(() => {
		const urlParam = getUrlParam();
		if (urlParam) setUrl(urlParam);
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
		<main className="flex min-h-screen items-center justify-center bg-[#060606] px-4 py-10 text-white">
			<section className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl shadow-black/40 backdrop-blur">
				<div className="mb-8 flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-black">
						<OttoWordmark height={14} />
					</div>
					<div>
						<p className="text-sm uppercase tracking-[0.3em] text-white/45">
							otto
						</p>
						<h1 className="text-2xl font-semibold tracking-tight">
							Connect to a tunnel
						</h1>
					</div>
				</div>

				<p className="mb-6 text-sm leading-6 text-white/60">
					Paste an otto tunnel URL to use this hosted web app with a shared
					local session. Links like{' '}
					<code className="rounded bg-white/10 px-1.5 py-0.5 text-white/80">
						app.ottocode.io/?url=...
					</code>{' '}
					will prefill this field.
				</p>

				<form className="space-y-4" onSubmit={handleSubmit}>
					<label className="block space-y-2">
						<span className="text-sm font-medium text-white/80">
							Tunnel URL
						</span>
						<input
							className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-white/35 focus:ring-4 focus:ring-white/10"
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://your-tunnel.trycloudflare.com"
							type="url"
							value={url}
						/>
					</label>

					{error ? (
						<div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
							{error}
						</div>
					) : null}

					<button
						className="flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={isConnecting}
						type="submit"
					>
						{isConnecting ? 'Connecting…' : 'Next'}
					</button>
				</form>
			</section>
		</main>
	);
}
