import {
	createOttoRouter,
	type OttoRouterPaymentCallbacks,
} from '@ottocode/sdk';
import { devToolsMiddleware } from '@ai-sdk/devtools';
import { getOttoRouterOAuthAuth } from '../../routes/ottorouter/service.ts';
import { isDevtoolsEnabled } from '../debug/state.ts';
import { publish } from '../../events/bus.ts';
import {
	waitForTopupMethodSelection,
	type TopupMethod,
} from '../topup/manager.ts';
import { providerFetch } from './fetch.ts';

const MIN_TOPUP_USD = 5;

export interface ResolveOttoRouterModelOptions {
	messageId?: string;
	projectRoot?: string;
	topupApprovalMode?: 'auto' | 'approval';
	autoPayThresholdUsd?: number;
}

export async function resolveOttoRouterModel(
	model: string,
	sessionId?: string,
	options: ResolveOttoRouterModelOptions = {},
) {
	const auth = await getOttoRouterOAuthAuth(options.projectRoot);
	if (!auth) {
		throw new Error(
			'OttoRouter provider requires OAuth. Run `otto auth login ottorouter` first.',
		);
	}
	const baseURL = process.env.OTTOROUTER_BASE_URL;
	const {
		messageId,
		topupApprovalMode = 'approval',
		autoPayThresholdUsd = MIN_TOPUP_USD,
	} = options;

	const callbacks: OttoRouterPaymentCallbacks = sessionId
		? {
				onPaymentRequired: (amountUsd, currentBalance) => {
					publish({
						type: 'ottorouter.payment.required',
						sessionId,
						payload: { amountUsd, currentBalance },
					});
				},
				onPaymentSigning: () => {
					publish({
						type: 'ottorouter.payment.signing',
						sessionId,
						payload: {},
					});
				},
				onPaymentComplete: (data) => {
					publish({
						type: 'ottorouter.payment.complete',
						sessionId,
						payload: data,
					});
				},
				onPaymentError: (error) => {
					publish({
						type: 'ottorouter.payment.error',
						sessionId,
						payload: { error },
					});
				},
				onBalanceUpdate: (update) => {
					publish({
						type: 'ottorouter.balance.updated',
						sessionId,
						payload: update,
					});
				},
				onPaymentApproval: async (info): Promise<TopupMethod | 'cancel'> => {
					const suggestedTopupUsd = Math.max(
						MIN_TOPUP_USD,
						Math.ceil(info.amountUsd * 2),
					);

					publish({
						type: 'ottorouter.topup.required',
						sessionId,
						payload: {
							messageId,
							amountUsd: info.amountUsd,
							currentBalance: info.currentBalance,
							minTopupUsd: MIN_TOPUP_USD,
							suggestedTopupUsd,
						},
					});

					return waitForTopupMethodSelection(
						sessionId,
						messageId ?? '',
						info.amountUsd,
						info.currentBalance,
					);
				},
			}
		: {};

	const ottorouter = createOttoRouter({
		auth,
		baseURL,
		fetch: providerFetch,
		callbacks,
		middleware: isDevtoolsEnabled() ? devToolsMiddleware() : undefined,
		cache: {
			promptCacheKey: sessionId,
		},
		payment: {
			topupApprovalMode,
			autoPayThresholdUsd,
		},
	});

	return ottorouter.model(model);
}
