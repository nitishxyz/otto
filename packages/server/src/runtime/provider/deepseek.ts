import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createDeepSeekModel } from '@ottocode/sdk';

export async function getDeepSeekInstance(cfg: OttoConfig, model: string) {
	const auth = await getAuth('deepseek', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createDeepSeekModel(model, { apiKey });
}
