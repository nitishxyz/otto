import type { Command } from 'commander';
import { log } from '@clack/prompts';
import qrcode from 'qrcode-terminal';
import { box, colors } from '../ui.ts';
import {
	getOttoRouterBalance,
	getOttoRouterWallet,
	getOttoRouterUsdcBalance,
} from '@ottocode/api';

export function registerOttoRouterCommand(program: Command) {
	program
		.command('ottorouter')
		.description('Manage OttoRouter wallet and view balance')
		.option('--login', 'Login/setup OttoRouter wallet')
		.action(async (options) => {
			const { runAuth } = await import('../auth.ts');

			if (options.login) {
				await runAuth(['login', 'ottorouter']);
				return;
			}

			console.log('');
			console.log(colors.bold('  OttoRouter Wallet'));
			console.log('');

			const { data: walletData, error: walletError } =
				await getOttoRouterWallet();

			if (walletError || !walletData) {
				log.warn('No OttoRouter wallet configured.');
				console.log(
					`  Run ${colors.cyan('otto ottorouter --login')} to setup your wallet.`,
				);
				console.log(
					`  Or set ${colors.cyan('OTTOROUTER_PRIVATE_KEY')} environment variable.`,
				);
				console.log('');
				return;
			}

			const wallet = walletData as {
				configured: boolean;
				publicKey?: string;
				network?: string;
				rpcUrl?: string;
				ottorouterUrl?: string;
			};

			if (!wallet.configured || !wallet.publicKey) {
				log.warn('No OttoRouter wallet configured.');
				console.log(
					`  Run ${colors.cyan('otto ottorouter --login')} to setup your wallet.`,
				);
				console.log('');
				return;
			}

			const publicKey = wallet.publicKey;
			const network = wallet.network ?? 'unknown';
			const rpcUrl = wallet.rpcUrl ?? '';
			const ottorouterUrl = wallet.ottorouterUrl ?? '';

			const networkLabel =
				network === 'mainnet'
					? colors.green('mainnet')
					: network === 'devnet'
						? colors.yellow('devnet')
						: colors.dim('unknown');

			const walletLines = [
				`Public Key: ${colors.cyan(publicKey)}`,
				`Network:    ${networkLabel}`,
				`RPC:        ${colors.dim(rpcUrl)}`,
				`OttoRouter: ${colors.dim(ottorouterUrl)}`,
			];

			box('Wallet', walletLines);

			console.log(colors.bold('  Wallet QR Code'));
			console.log('');
			qrcode.generate(publicKey, { small: true }, (qr: string) => {
				console.log(qr);
			});

			console.log(colors.dim('  Fetching balances...'));
			const [balanceResult, usdcResult] = await Promise.all([
				getOttoRouterBalance(),
				getOttoRouterUsdcBalance(),
			]);

			const usdcData = usdcResult.data as {
				usdcBalance: number;
			} | null;

			if (usdcData?.usdcBalance !== undefined) {
				console.log(
					`  USDC:     ${colors.green(`${usdcData.usdcBalance.toFixed(2)} USDC`)}`,
				);
			} else {
				console.log(`  USDC:     ${colors.dim('Could not fetch')}`);
			}

			const balanceData = balanceResult.data as {
				balance: number;
				totalSpent: number;
				totalTopups: number;
				requestCount: number;
				scope?: string;
				payg?: {
					walletBalanceUsd: number;
					accountBalanceUsd: number;
					rawPoolUsd: number;
					effectiveSpendableUsd: number;
				};
				limits?: {
					enabled: boolean;
					dailyLimitUsd: number | null;
					dailySpentUsd: number;
					dailyRemainingUsd: number | null;
					monthlyLimitUsd: number | null;
					monthlySpentUsd: number;
					monthlyRemainingUsd: number | null;
					capRemainingUsd: number | null;
				} | null;
				subscription?: {
					active: boolean;
					tierId?: string;
					tierName?: string;
					creditsIncluded?: number;
					creditsUsed?: number;
					creditsRemaining?: number;
					periodStart?: string;
					periodEnd?: string;
				} | null;
			} | null;

			if (balanceData) {
				const accountLines = [
					`Balance:      ${colors.green(`$${balanceData.balance.toFixed(4)}`)}`,
					`Total Spent:  ${colors.dim(`$${balanceData.totalSpent.toFixed(4)}`)}`,
					`Total Topups: ${colors.dim(`$${balanceData.totalTopups.toFixed(4)}`)}`,
					`Requests:     ${colors.dim(balanceData.requestCount.toString())}`,
				];

				if (balanceData.scope) {
					accountLines.push(`Scope:        ${colors.dim(balanceData.scope)}`);
				}

				if (balanceData.payg) {
					const p = balanceData.payg;
					accountLines.push(
						`Wallet Bal:   ${colors.dim(`$${p.walletBalanceUsd.toFixed(4)}`)}`,
						`Account Bal:  ${colors.dim(`$${p.accountBalanceUsd.toFixed(4)}`)}`,
						`Spendable:    ${colors.green(`$${p.effectiveSpendableUsd.toFixed(4)}`)}`,
					);
				}

				box('OttoRouter Account', accountLines);

				if (balanceData.subscription?.active) {
					const sub = balanceData.subscription;
					const subLines = [
						`Tier:         ${colors.cyan(sub.tierName ?? sub.tierId ?? 'unknown')}`,
					];
					if (
						sub.creditsIncluded !== undefined &&
						sub.creditsUsed !== undefined
					) {
						const pct =
							sub.creditsIncluded > 0
								? ((sub.creditsUsed / sub.creditsIncluded) * 100).toFixed(1)
								: '0';
						subLines.push(
							`Credits:      ${colors.dim(`${sub.creditsUsed.toFixed(2)} / ${sub.creditsIncluded.toFixed(2)} (${pct}%)`)}`,
						);
					}
					if (sub.creditsRemaining !== undefined) {
						subLines.push(
							`Remaining:    ${colors.green(`${sub.creditsRemaining.toFixed(2)} credits`)}`,
						);
					}
					if (sub.periodEnd) {
						const endDate = new Date(sub.periodEnd);
						subLines.push(
							`Period Ends:  ${colors.dim(endDate.toLocaleDateString())}`,
						);
					}
					box('Subscription', subLines);
				}

				if (balanceData.limits) {
					const lim = balanceData.limits;
					const limLines = [
						`Enabled:      ${lim.enabled ? colors.green('yes') : colors.dim('no')}`,
					];
					if (lim.dailyLimitUsd !== null) {
						limLines.push(
							`Daily:        ${colors.dim(`$${lim.dailySpentUsd.toFixed(4)} / $${lim.dailyLimitUsd.toFixed(4)}`)}`,
						);
					}
					if (lim.monthlyLimitUsd !== null) {
						limLines.push(
							`Monthly:      ${colors.dim(`$${lim.monthlySpentUsd.toFixed(4)} / $${lim.monthlyLimitUsd.toFixed(4)}`)}`,
						);
					}
					box('Spending Limits', limLines);
				}
			} else {
				log.warn('Could not fetch OttoRouter account balance.');
			}

			console.log('');
		});
}
