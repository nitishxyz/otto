type MessageBlock = {
	type: string;
	cache_control?: { type: string };
	[key: string]: unknown;
};

type Message = {
	role: string;
	content: unknown;
	[key: string]: unknown;
};

type ParsedBody = {
	system?: MessageBlock[];
	messages?: Message[];
	[key: string]: unknown;
};

type FetchLike = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

export function addAnthropicCacheControl(parsed: ParsedBody): ParsedBody {
	const MAX_SYSTEM_CACHE = 1;
	const MAX_MESSAGE_CACHE = 1;
	let systemCacheUsed = 0;
	let messageCacheUsed = 0;

	if (parsed.system && Array.isArray(parsed.system)) {
		parsed.system = parsed.system.map((block, index) => {
			if (block.cache_control) return block;
			if (
				systemCacheUsed < MAX_SYSTEM_CACHE &&
				index === 0 &&
				block.type === 'text'
			) {
				systemCacheUsed++;
				return { ...block, cache_control: { type: 'ephemeral' } };
			}
			return block;
		});
	}

	if (parsed.messages && Array.isArray(parsed.messages)) {
		const messageCount = parsed.messages.length;
		parsed.messages = parsed.messages.map((msg, msgIndex) => {
			const isLast = msgIndex === messageCount - 1;

			if (Array.isArray(msg.content)) {
				const blocks = msg.content as MessageBlock[];
				const content = blocks.map((block, blockIndex) => {
					if (block.cache_control) return block;
					if (
						isLast &&
						messageCacheUsed < MAX_MESSAGE_CACHE &&
						blockIndex === blocks.length - 1
					) {
						messageCacheUsed++;
						return { ...block, cache_control: { type: 'ephemeral' } };
					}
					return block;
				});
				return { ...msg, content };
			}

			if (
				isLast &&
				messageCacheUsed < MAX_MESSAGE_CACHE &&
				typeof msg.content === 'string'
			) {
				messageCacheUsed++;
				return {
					...msg,
					content: [
						{
							type: 'text',
							text: msg.content,
							cache_control: { type: 'ephemeral' },
						},
					],
				};
			}

			return msg;
		});
	}

	return parsed;
}

export function createAnthropicCachingFetch(
	baseFetch: typeof fetch = fetch,
): FetchLike {
	return async (input, init) => {
		let body = init?.body;
		if (body && typeof body === 'string') {
			try {
				const parsed = JSON.parse(body);
				const modified = addAnthropicCacheControl(parsed);
				body = JSON.stringify(modified);
			} catch {
				// If parsing fails, send as-is
			}
		}
		return baseFetch(input, { ...init, body });
	};
}

export function createConditionalCachingFetch(
	shouldCache: (model: string) => boolean,
	model: string,
	baseFetch: typeof fetch = fetch,
): FetchLike {
	return async (input, init) => {
		if (!shouldCache(model)) {
			return baseFetch(input, init);
		}

		let body = init?.body;
		if (body && typeof body === 'string') {
			try {
				const parsed = JSON.parse(body);

				const MAX_SYSTEM_CACHE = 1;
				const MAX_MESSAGE_CACHE = 1;
				let systemCacheUsed = 0;
				let messageCacheUsed = 0;

				if (parsed.messages && Array.isArray(parsed.messages)) {
					const messageCount = parsed.messages.length;
					parsed.messages = parsed.messages.map(
						(msg: Message, msgIndex: number) => {
							if (msg.role === 'system' && systemCacheUsed < MAX_SYSTEM_CACHE) {
								systemCacheUsed++;
								if (typeof msg.content === 'string') {
									return {
										...msg,
										content: [
											{
												type: 'text',
												text: msg.content,
												cache_control: { type: 'ephemeral' },
											},
										],
									};
								}
								if (Array.isArray(msg.content)) {
									const blocks = msg.content as MessageBlock[];
									const content = blocks.map((block, i) => {
										if (i === blocks.length - 1 && !block.cache_control) {
											return { ...block, cache_control: { type: 'ephemeral' } };
										}
										return block;
									});
									return { ...msg, content };
								}
							}

							const isLast = msgIndex === messageCount - 1;

							if (Array.isArray(msg.content)) {
								const blocks = msg.content as MessageBlock[];
								const content = blocks.map((block, blockIndex) => {
									if (block.cache_control) return block;
									if (
										isLast &&
										messageCacheUsed < MAX_MESSAGE_CACHE &&
										blockIndex === blocks.length - 1
									) {
										messageCacheUsed++;
										return { ...block, cache_control: { type: 'ephemeral' } };
									}
									return block;
								});
								return { ...msg, content };
							}

							if (
								isLast &&
								messageCacheUsed < MAX_MESSAGE_CACHE &&
								typeof msg.content === 'string'
							) {
								messageCacheUsed++;
								return {
									...msg,
									content: [
										{
											type: 'text',
											text: msg.content,
											cache_control: { type: 'ephemeral' },
										},
									],
								};
							}

							return msg;
						},
					);
				}

				body = JSON.stringify(parsed);
			} catch {
				// If parsing fails, send as-is
			}
		}

		return baseFetch(input, { ...init, body });
	};
}
