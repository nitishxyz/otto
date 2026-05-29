import type {
	OpenClawPluginDefinition,
	OpenClawPluginApi,
	OpenClawPluginCommandDefinition,
} from './types.ts';
import {
	loadWallet,
	ensureWallet,
	getOttoRouterBalance,
	getWalletKeyPath,
} from './wallet.ts';
import {
	buildProviderConfig,
	injectConfig,
	injectAuthProfile,
	isConfigured,
} from './config.ts';
import { isValidPrivateKey } from '@ottocode/ai-sdk';

const DEFAULT_PORT = 8403;

function getPort(api: OpenClawPluginApi): number {
	const cfg = api.pluginConfig as Record<string, unknown> | undefined;
	return (cfg?.port as number) ?? DEFAULT_PORT;
}

const plugin: OpenClawPluginDefinition = {
	id: 'openclaw',
	name: 'OttoRouter',
	description: 'Pay for AI with Solana USDC — no API keys, just a wallet.',
	version: '0.1.0',

	register(api: OpenClawPluginApi) {
		const port = getPort(api);

		try {
			injectConfig(port);
		} catch {}
		try {
			injectAuthProfile();
		} catch {}

		if (!api.config.models) {
			api.config.models = { providers: {} };
		}
		if (!api.config.models.providers) {
			api.config.models.providers = {};
		}
		const providerConfig = buildProviderConfig(port);
		api.config.models.providers.ottorouter = {
			baseUrl: providerConfig.baseUrl,
			api: providerConfig.api,
			apiKey: providerConfig.apiKey,
			models: providerConfig.models,
		};

		if (!api.config.agents) api.config.agents = {};
		const agents = api.config.agents as Record<string, unknown>;
		if (!agents.defaults) agents.defaults = {};
		const defaults = agents.defaults as Record<string, unknown>;
		if (!defaults.model) defaults.model = {};
		const model = defaults.model as Record<string, unknown>;
		if (!model.primary) {
			model.primary = 'ottorouter/claude-sonnet-4-6';
		}

		api.registerProvider({
			id: 'ottorouter',
			label: 'OttoRouter (Solana USDC)',
			aliases: ['ottorouter-solana'],
			envVars: ['OTTOROUTER_PRIVATE_KEY'],
			models: buildProviderConfig(port),
			auth: [
				{
					id: 'ottorouter-wallet',
					label: 'Solana Wallet',
					hint: 'Generate or import a Solana wallet — pay per token with USDC',
					kind: 'custom',
					async run(ctx) {
						const existing = loadWallet();

						if (existing) {
							ctx.prompter.note(
								`Existing OttoRouter wallet found: ${existing.publicKey}`,
							);
							return {
								profiles: [
									{
										profileId: 'ottorouter-wallet',
										credential: {
											apiKey: 'ottorouter-proxy-handles-auth',
											type: 'wallet',
											walletAddress: existing.publicKey,
										},
									},
								],
								configPatch: {
									models: {
										providers: { ottorouter: buildProviderConfig(port) },
									},
								},
								defaultModel: `ottorouter/claude-sonnet-4-6`,
								notes: [
									`Wallet: ${existing.publicKey}`,
									`Fund with USDC on Solana to start using.`,
									`Run \`openclaw start\` to start the proxy.`,
								],
							};
						}

						const keyInput = await ctx.prompter.text({
							message:
								'Enter Solana private key (base58) or press Enter to generate a new one:',
							validate: (value: string) => {
								if (value && !isValidPrivateKey(value)) {
									return 'Invalid Solana private key';
								}
								return undefined;
							},
						});

						const key = typeof keyInput === 'string' ? keyInput.trim() : '';
						if (key && isValidPrivateKey(key)) {
							const { saveWallet } = await import('./wallet.ts');
							saveWallet(key);
						} else {
							ensureWallet();
						}

						const finalWallet = loadWallet();
						if (!finalWallet) throw new Error('Failed to load wallet');

						await injectConfig(port);

						return {
							profiles: [
								{
									profileId: 'ottorouter-wallet',
									credential: {
										apiKey: 'ottorouter-proxy-handles-auth',
										type: 'wallet',
										walletAddress: finalWallet.publicKey,
									},
								},
							],
							configPatch: {
								models: {
									providers: { ottorouter: buildProviderConfig(port) },
								},
							},
							defaultModel: `ottorouter/claude-sonnet-4-6`,
							notes: [
								`Wallet generated: ${finalWallet.publicKey}`,
								`Key stored at: ${getWalletKeyPath()}`,
								`Fund with USDC on Solana: ${finalWallet.publicKey}`,
								`Run \`openclaw start\` to start the proxy.`,
							],
						};
					},
				},
			],
		});

		const walletCmd: OpenClawPluginCommandDefinition = {
			name: 'wallet',
			description: 'Show your OttoRouter wallet address and balances',
			requireAuth: true,
			async handler() {
				const wallet = loadWallet();
				if (!wallet) {
					return {
						text: 'No OttoRouter wallet found. Run `openclaw setup`.',
					};
				}

				const balances = await getOttoRouterBalance(wallet.privateKey);
				const lines = [`Wallet: ${wallet.publicKey}`];

				if (balances.ottorouter) {
					lines.push(
						`OttoRouter Balance: $${balances.ottorouter.balance.toFixed(4)}`,
					);
					lines.push(
						`Total Spent: $${balances.ottorouter.totalSpent.toFixed(4)}`,
					);
					lines.push(`Requests: ${balances.ottorouter.requestCount}`);
				}
				if (balances.wallet) {
					lines.push(
						`On-chain USDC: $${balances.wallet.usdcBalance.toFixed(4)} (${balances.wallet.network})`,
					);
				}

				return { text: lines.join('\n') };
			},
		};

		api.registerCommand(walletCmd);

		const statusCmd: OpenClawPluginCommandDefinition = {
			name: 'ottorouter-status',
			description: 'Check OttoRouter plugin configuration status',
			async handler() {
				const wallet = loadWallet();
				const configured = isConfigured();
				const lines = [
					`Wallet: ${wallet ? wallet.publicKey : 'not set up'}`,
					`OpenClaw config: ${configured ? 'injected' : 'not configured'}`,
					`Proxy port: ${port}`,
				];
				return { text: lines.join('\n') };
			},
		};

		api.registerCommand(statusCmd);

		api.registerService({
			id: 'ottorouter-proxy',
			async start() {
				if (typeof globalThis.Bun === 'undefined') {
					api.logger.info(
						'OttoRouter: Run `openclaw start` to start the proxy (requires Bun).',
					);
					return;
				}
				const wallet = loadWallet();
				if (!wallet) {
					api.logger.warn(
						'OttoRouter: No wallet found. Run `openclaw setup` first.',
					);
					return;
				}
				try {
					const { createProxy } = await import('./proxy.ts');
					createProxy({ port, verbose: false });
					api.logger.info(
						`OttoRouter proxy running on http://localhost:${port}`,
					);
				} catch (err) {
					api.logger.error(
						`OttoRouter proxy failed: ${(err as Error).message}`,
					);
				}
			},
		});
	},
};

export default plugin;
