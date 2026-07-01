import { useKeyboard } from '@opentui/react';
import { useState, useEffect } from 'react';
import { getAllModels, getProviderUsage } from '@ottocode/api';
import { useTheme } from '../theme.ts';
import { ModalFrame } from './ModalFrame.tsx';
import { getProjectQuery } from '../api.ts';

interface UsageWindow {
	usedPercent?: number;
	windowSeconds?: number;
	resetsAt?: string | null;
	resetAfterSeconds?: number;
}

interface UsageData {
	provider: string;
	primaryWindow?: UsageWindow | null;
	secondaryWindow?: UsageWindow | null;
	limitReached: boolean;
	planType?: string | null;
}

interface UsageOverlayProps {
	currentProvider: string;
	onClose: () => void;
}

function formatTimeRemaining(resetsAt: string | null | undefined): string {
	if (!resetsAt) return 'Unknown';
	const now = Date.now();
	const reset = new Date(resetsAt).getTime();
	const diff = reset - now;
	if (diff <= 0) return 'Now';
	const days = Math.floor(diff / 86_400_000);
	const hours = Math.floor((diff % 86_400_000) / 3_600_000);
	const minutes = Math.floor((diff % 3_600_000) / 60_000);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function windowLabel(seconds: number | undefined): string {
	if (!seconds) return 'Window';
	if (seconds <= 18000) return '5 Hour';
	if (seconds <= 86400) return '24 Hour';
	if (seconds > 1209600) return 'Monthly';
	return '7 Day';
}

function makeBar(percent: number, width: number): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	return '█'.repeat(filled) + '░'.repeat(empty);
}

function barColor(
	percent: number,
	colors: ReturnType<typeof useTheme>['colors'],
): string {
	if (percent >= 90) return colors.red;
	if (percent >= 70) return colors.yellow;
	return colors.blue;
}

export function UsageOverlay({ currentProvider, onClose }: UsageOverlayProps) {
	const { colors } = useTheme();
	const [usage, setUsage] = useState<UsageData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [_isOAuth, setIsOAuth] = useState(false);

	useEffect(() => {
		let cancelled = false;

		async function fetchUsage() {
			try {
				const modelsRes = await getAllModels({
					query: getProjectQuery(),
				} as never);
				// biome-ignore lint/suspicious/noExplicitAny: SDK response type
				const modelsData = modelsRes.data as any;
				if (!modelsData) {
					if (!cancelled) setError('Failed to load models');
					return;
				}

				const providerInfo = modelsData[currentProvider];
				const authType = providerInfo?.authType;
				const isOAuthProvider =
					authType === 'oauth' &&
					(currentProvider === 'anthropic' ||
						currentProvider === 'openai' ||
						currentProvider === 'xai' ||
						currentProvider === 'kimi');

				if (!cancelled) setIsOAuth(isOAuthProvider);

				if (!isOAuthProvider) {
					if (!cancelled) {
						setLoading(false);
						setError(
							'Usage is only available for OAuth providers (OpenAI, Anthropic, xAI, Kimi)',
						);
					}
					return;
				}

				const usageRes = await getProviderUsage({
					// biome-ignore lint/suspicious/noExplicitAny: API path type
					path: { provider: currentProvider } as any,
					query: getProjectQuery(),
				} as never);

				if (!cancelled) {
					if (usageRes.error) {
						setError('Failed to fetch usage');
					} else {
						// biome-ignore lint/suspicious/noExplicitAny: SDK response type
						setUsage(usageRes.data as any);
					}
					setLoading(false);
				}
			} catch {
				if (!cancelled) {
					setError('Failed to fetch usage');
					setLoading(false);
				}
			}
		}

		fetchUsage();
		return () => {
			cancelled = true;
		};
	}, [currentProvider]);

	const BAR_WIDTH = 30;

	useKeyboard((key) => {
		if (key.name === 'escape') onClose();
	});

	return (
		<ModalFrame title="Usage & Limits" size="md" footer="esc close">
			<box style={{ flexDirection: 'row', gap: 1 }}>
				<text fg={colors.blue}>
					<b>Provider:</b>
				</text>
				<text fg={colors.fg}>{currentProvider}</text>
			</box>

			{loading && (
				<box style={{ marginTop: 1 }}>
					<text fg={colors.fgDark}>Loading usage…</text>
				</box>
			)}

			{error && (
				<box style={{ marginTop: 1 }}>
					<text fg={colors.yellow}>{error}</text>
				</box>
			)}

			{!loading && !error && usage && (
				<box style={{ flexDirection: 'column', marginTop: 1, gap: 1 }}>
					{usage.limitReached && (
						<box style={{ flexDirection: 'row', gap: 1 }}>
							<text fg={colors.red}>●</text>
							<text fg={colors.red}>
								<b>Rate limit reached</b>
							</text>
						</box>
					)}

					{usage.primaryWindow && (
						<box style={{ flexDirection: 'column' }}>
							<box style={{ flexDirection: 'row', gap: 1 }}>
								<text fg={colors.fgMuted}>
									{windowLabel(usage.primaryWindow.windowSeconds)} Window
								</text>
								<text fg={colors.fg}>
									{Math.round(usage.primaryWindow.usedPercent ?? 0)}%
								</text>
								{usage.primaryWindow.resetsAt && (
									<text fg={colors.fgDark}>
										resets in{' '}
										{formatTimeRemaining(usage.primaryWindow.resetsAt)}
									</text>
								)}
							</box>
							<text fg={barColor(usage.primaryWindow.usedPercent ?? 0, colors)}>
								{makeBar(usage.primaryWindow.usedPercent ?? 0, BAR_WIDTH)}
							</text>
						</box>
					)}

					{usage.secondaryWindow && (
						<box style={{ flexDirection: 'column' }}>
							<box style={{ flexDirection: 'row', gap: 1 }}>
								<text fg={colors.fgMuted}>
									{windowLabel(usage.secondaryWindow.windowSeconds)} Window
								</text>
								<text fg={colors.fg}>
									{Math.round(usage.secondaryWindow.usedPercent ?? 0)}%
								</text>
								{usage.secondaryWindow.resetsAt && (
									<text fg={colors.fgDark}>
										resets in{' '}
										{formatTimeRemaining(usage.secondaryWindow.resetsAt)}
									</text>
								)}
							</box>
							<text
								fg={barColor(usage.secondaryWindow.usedPercent ?? 0, colors)}
							>
								{makeBar(usage.secondaryWindow.usedPercent ?? 0, BAR_WIDTH)}
							</text>
						</box>
					)}

					{usage.planType && (
						<box style={{ flexDirection: 'row', gap: 1, marginTop: 1 }}>
							<text fg={colors.fgMuted}>Plan:</text>
							<text fg={colors.fg}>{usage.planType}</text>
						</box>
					)}

					{!usage.primaryWindow &&
						!usage.secondaryWindow &&
						!usage.limitReached && (
							<text fg={colors.fgDark}>No usage data available</text>
						)}
				</box>
			)}
		</ModalFrame>
	);
}
