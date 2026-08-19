import { createHash, randomBytes } from 'node:crypto';

function createBase64UrlRandomValue(): string {
	return randomBytes(32).toString('base64url');
}

export function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = createBase64UrlRandomValue();
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

export function createOAuthState(): string {
	return createBase64UrlRandomValue();
}
