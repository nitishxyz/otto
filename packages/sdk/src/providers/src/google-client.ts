import { google, createGoogleGenerativeAI } from '@ai-sdk/google';

export type GoogleProviderConfig = {
	apiKey?: string;
	fetch?: typeof fetch;
};

export function createGoogleModel(
	model: string,
	config?: GoogleProviderConfig,
) {
	if (config?.apiKey || config?.fetch) {
		const instance = createGoogleGenerativeAI({
			apiKey: config?.apiKey,
			fetch: config?.fetch,
		});
		return instance(model);
	}
	return google(model);
}
