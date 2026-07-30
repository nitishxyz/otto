import { PATCH_BEGIN_MARKER } from './constants.ts';
import { parseEnvelopedPatch } from './parse-enveloped.ts';
import { parseUnifiedPatch } from './parse-unified.ts';
import type { PatchOperation } from './types.ts';

export type PatchFormat = 'enveloped' | 'unified';

export function parsePatchInput(patch: string): {
	format: PatchFormat;
	operations: PatchOperation[];
} {
	const trimmed = patch.trim();
	if (!trimmed) {
		throw new Error('Patch content is empty.');
	}

	if (trimmed.toLowerCase().startsWith(PATCH_BEGIN_MARKER.toLowerCase())) {
		return {
			format: 'enveloped',
			operations: parseEnvelopedPatch(patch),
		};
	}

	return {
		format: 'unified',
		operations: parseUnifiedPatch(patch),
	};
}
