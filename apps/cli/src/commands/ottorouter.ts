import type { Command } from 'commander';
import { log } from '@clack/prompts';
import { box, colors } from '../ui.ts';
import { getOttoRouterBalance } from '@ottocode/api';

export function registerOttoRouterCommand(program: Command) {
	program
		.command('ottorouter')
		.description('Manage OttoRouter OAuth and view balance')
		.option('--login', 'Login to OttoRouter with OAuth')
		.action(async (options) => {
			const { runAuth } = await import('../auth.ts');

			if (options.login) {
				await runAuth(['login', 'ottorouter']);
				return;
			}

			console.log('');
			console.log(colors.bold('  OttoRouter'));
			console.log('');

			console.log(colors.dim('  Fetching balances...'));
			const balanceResult = await getOttoRouterBalance();

			if (balanceResult.error) {
				log.warn('No OttoRouter OAuth session configured.');
				console.log(
					`  Run ${colors.cyan('otto ottorouter --login')} to authenticate with OAuth.`,
				);
				console.log('');
				return;
			}

			const balanceData = balanceResult.data as {
				balance: number;
				totalSpent: number;
				totalTopups: number;
				requestCount: number;
				scope?: string;
				payg?: {
					walletBalanceUsd?: number;
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
