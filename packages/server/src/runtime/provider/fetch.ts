import { createResilientFetch } from '@ottocode/sdk';

export const providerFetch = createResilientFetch() as typeof fetch;
