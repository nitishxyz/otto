import { OAuthCredentialStore } from '@ottocode/sdk';
import type { CopilotMCPSession } from './service.ts';

export const copilotMCPOAuthStore = new OAuthCredentialStore();

export const copilotMCPSessions = new Map<string, CopilotMCPSession>();
