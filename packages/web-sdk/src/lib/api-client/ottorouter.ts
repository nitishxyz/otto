import {
	getOttoRouterBalance as apiGetOttoRouterBalance,
	createPolarCheckout as apiCreatePolarCheckout,
	getPolarTopupEstimate as apiGetPolarTopupEstimate,
	getPolarTopupStatus as apiGetPolarTopupStatus,
	getRazorpayTopupEstimate as apiGetRazorpayTopupEstimate,
	createRazorpayOrder as apiCreateRazorpayOrder,
	verifyRazorpayPayment as apiVerifyRazorpayPayment,
	selectTopupMethod as apiSelectTopupMethod,
	cancelTopup as apiCancelTopup,
	getPendingTopup as apiGetPendingTopup,
} from '@ottocode/api';
import { extractErrorMessage } from './utils';

export const ottorouterMixin = {
	async getOttoRouterBalance(): Promise<{
		walletAddress: string;
		balance: number;
		totalSpent: number;
		totalTopups: number;
		requestCount: number;
		scope?: 'wallet' | 'account';
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
			creditsWeeklyLimit?: number | null;
			creditsFiveHourLimit?: number | null;
			usageWindows?: {
				weekly: {
					limit: number | null;
					used: number;
					remaining: number | null;
					percentUsed: number;
				};
				fiveHour: {
					limit: number | null;
					used: number;
					remaining: number | null;
					percentUsed: number;
				};
			};
			periodStart?: string;
			periodEnd?: string;
		} | null;
	} | null> {
		try {
			const response = await apiGetOttoRouterBalance();
			if (response.error) return null;
			// biome-ignore lint/suspicious/noExplicitAny: API response structure
			return response.data as any;
		} catch {
			return null;
		}
	},

	async getPolarTopupEstimate(amount: number): Promise<{
		creditAmount: number;
		chargeAmount: number;
		feeAmount: number;
		feeBreakdown: {
			basePercent: number;
			internationalPercent: number;
			fixedCents: number;
		};
	} | null> {
		try {
			const response = await apiGetPolarTopupEstimate({
				query: { amount },
			});
			if (response.error) return null;
			// biome-ignore lint/suspicious/noExplicitAny: API response structure
			return response.data as any;
		} catch {
			return null;
		}
	},

	async createPolarCheckout(
		amount: number,
		successUrl: string,
	): Promise<{
		success: boolean;
		checkoutId: string;
		checkoutUrl: string;
		creditAmount: number;
		chargeAmount: number;
		feeAmount: number;
	}> {
		const response = await apiCreatePolarCheckout({
			body: { amount, successUrl },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async selectTopupMethod(
		sessionId: string,
		method: 'fiat',
	): Promise<{ success: boolean; method: string }> {
		const response = await apiSelectTopupMethod({
			body: { sessionId, method },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async cancelTopup(
		sessionId: string,
		reason?: string,
	): Promise<{ success: boolean }> {
		const response = await apiCancelTopup({
			body: { sessionId, reason },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async getPendingTopup(sessionId: string): Promise<{
		hasPending: boolean;
		sessionId?: string;
		messageId?: string;
		amountUsd?: number;
		currentBalance?: number;
		createdAt?: number;
	}> {
		try {
			const response = await apiGetPendingTopup({
				query: { sessionId },
			});
			if (response.error) return { hasPending: false };
			// biome-ignore lint/suspicious/noExplicitAny: API response structure
			return response.data as any;
		} catch {
			return { hasPending: false };
		}
	},

	async getPolarTopupStatus(checkoutId: string): Promise<{
		checkoutId: string;
		confirmed: boolean;
		amountUsd: number | null;
		confirmedAt: string | null;
	} | null> {
		try {
			const response = await apiGetPolarTopupStatus({
				query: { checkoutId },
			});
			if (response.error) return null;
			// biome-ignore lint/suspicious/noExplicitAny: API response structure
			return response.data as any;
		} catch {
			return null;
		}
	},

	async getRazorpayTopupEstimate(amount: number): Promise<{
		creditAmountUsd: number;
		chargeAmountInr: number;
		feeAmountInr: number;
		currency: string;
		exchangeRate: number;
	} | null> {
		try {
			const response = await apiGetRazorpayTopupEstimate({
				query: { amount },
			});
			if (response.error) return null;
			// biome-ignore lint/suspicious/noExplicitAny: API response structure
			return response.data as any;
		} catch {
			return null;
		}
	},

	async createRazorpayOrder(amount: number): Promise<{
		success: boolean;
		orderId: string;
		amount: number;
		currency: string;
		creditAmountUsd: number;
		keyId: string;
	}> {
		const response = await apiCreateRazorpayOrder({
			body: { amount },
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},

	async verifyRazorpayPayment(params: {
		razorpay_order_id: string;
		razorpay_payment_id: string;
		razorpay_signature: string;
	}): Promise<{
		success: boolean;
		credited: number;
		newBalance: number;
	}> {
		const response = await apiVerifyRazorpayPayment({
			body: params,
		});
		if (response.error) throw new Error(extractErrorMessage(response.error));
		// biome-ignore lint/suspicious/noExplicitAny: API response structure
		return response.data as any;
	},
};
