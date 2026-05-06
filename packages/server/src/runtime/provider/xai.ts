import type { OttoConfig } from '@ottocode/sdk';
import { getAuth, createXaiModel } from '@ottocode/sdk';

export async function getXaiInstance(cfg: OttoConfig, model: string) {
	const auth = await getAuth('xai', cfg.projectRoot);
	const apiKey = auth?.type === 'api' ? auth.key : undefined;
	return createXaiModel(model, { apiKey });
}
