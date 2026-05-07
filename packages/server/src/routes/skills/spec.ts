const projectQueryParameter = {
	in: 'query',
	name: 'project',
	required: false,
	schema: { type: 'string' },
	description: 'Project root override (defaults to current working directory).',
};

const skillNamePathParameter = {
	in: 'path',
	name: 'name',
	required: true,
	schema: { type: 'string' },
};

const errorResponse = {
	description: 'Bad Request',
	content: {
		'application/json': {
			schema: {
				type: 'object',
				properties: {
					error: { type: 'string' },
				},
				required: ['error'],
			},
		},
	},
};

const skillListItemSchema = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { type: 'string' },
		scope: { type: 'string' },
		path: { type: 'string' },
	},
	required: ['name', 'description', 'scope', 'path'],
};

const skillConfigItemSchema = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { type: 'string' },
		scope: { type: 'string' },
		path: { type: 'string' },
		enabled: { type: 'boolean' },
	},
	required: ['name', 'description', 'scope', 'path', 'enabled'],
};

const skillConfigSchema = {
	type: 'object',
	properties: {
		enabled: { type: 'boolean' },
		totalCount: { type: 'number' },
		enabledCount: { type: 'number' },
		items: {
			type: 'array',
			items: skillConfigItemSchema,
		},
	},
	required: ['enabled', 'totalCount', 'enabledCount', 'items'],
};

const skillConfigUpdateSchema = {
	type: 'object',
	properties: {
		enabled: { type: 'boolean' },
		items: {
			type: 'object',
			additionalProperties: {
				type: 'object',
				properties: {
					enabled: { type: 'boolean' },
				},
			},
		},
	},
};

const skillConfigUpdateResponseSchema = {
	type: 'object',
	properties: {
		success: { type: 'boolean' },
		...skillConfigSchema.properties,
	},
	required: ['success', 'enabled', 'totalCount', 'enabledCount', 'items'],
};

const skillDetailSchema = {
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { type: 'string' },
		license: { type: 'string', nullable: true },
		compatibility: { type: 'string', nullable: true },
		metadata: { type: 'object', nullable: true },
		allowedTools: {
			type: 'array',
			items: { type: 'string' },
			nullable: true,
		},
		path: { type: 'string' },
		scope: { type: 'string' },
		content: { type: 'string' },
	},
	required: ['name', 'description', 'path', 'scope', 'content'],
};

const skillFileListSchema = {
	type: 'object',
	properties: {
		files: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					relativePath: { type: 'string' },
					size: { type: 'number' },
				},
				required: ['relativePath', 'size'],
			},
		},
	},
	required: ['files'],
};

const skillFileSchema = {
	type: 'object',
	properties: {
		content: { type: 'string' },
		path: { type: 'string' },
	},
	required: ['content', 'path'],
};

const validateSkillRequestSchema = {
	type: 'object',
	properties: {
		content: { type: 'string' },
		path: { type: 'string' },
	},
	required: ['content'],
};

const validateSkillResponseSchema = {
	type: 'object',
	properties: {
		valid: { type: 'boolean' },
		name: { type: 'string' },
		description: { type: 'string' },
		license: { type: 'string', nullable: true },
		error: { type: 'string' },
	},
	required: ['valid'],
};

const validateNameResponseSchema = {
	type: 'object',
	properties: {
		valid: { type: 'boolean' },
	},
	required: ['valid'],
};

function jsonResponse(schema: object, description = 'OK') {
	return {
		description,
		content: {
			'application/json': { schema },
		},
	};
}

export const listSkillsSpec = {
	method: 'get',
	path: '/v1/skills',
	tags: ['config'],
	operationId: 'listSkills',
	summary: 'List discovered skills',
	parameters: [projectQueryParameter],
	responses: {
		'200': jsonResponse({
			type: 'object',
			properties: {
				skills: {
					type: 'array',
					items: skillListItemSchema,
				},
			},
			required: ['skills'],
		}),
		'500': errorResponse,
	},
};

export const getSkillsConfigSpec = {
	method: 'get',
	path: '/v1/config/skills',
	tags: ['config'],
	operationId: 'getSkillsConfig',
	summary: 'Get skills enable/disable config and counts',
	parameters: [projectQueryParameter],
	responses: {
		'200': jsonResponse(skillConfigSchema),
		'500': errorResponse,
	},
};

export const updateSkillsConfigSpec = {
	method: 'put',
	path: '/v1/config/skills',
	tags: ['config'],
	operationId: 'updateSkillsConfig',
	summary: 'Update skills enable/disable config',
	parameters: [projectQueryParameter],
	requestBody: {
		required: true,
		content: {
			'application/json': { schema: skillConfigUpdateSchema },
		},
	},
	responses: {
		'200': jsonResponse(skillConfigUpdateResponseSchema),
		'500': errorResponse,
	},
};

export const getSkillSpec = {
	method: 'get',
	path: '/v1/skills/{name}',
	tags: ['config'],
	operationId: 'getSkill',
	summary: 'Get a skill by name',
	parameters: [skillNamePathParameter, projectQueryParameter],
	responses: {
		'200': jsonResponse(skillDetailSchema),
		'404': errorResponse,
		'500': errorResponse,
	},
};

export const listSkillFilesSpec = {
	method: 'get',
	path: '/v1/skills/{name}/files',
	tags: ['config'],
	operationId: 'listSkillFiles',
	summary: 'List files in a skill directory',
	parameters: [skillNamePathParameter, projectQueryParameter],
	responses: {
		'200': jsonResponse(skillFileListSchema),
		'500': errorResponse,
	},
};

export const getSkillFileSpec = {
	method: 'get',
	path: '/v1/skills/{name}/files/{filePath}',
	tags: ['config'],
	operationId: 'getSkillFile',
	summary: 'Read a specific file from a skill directory',
	parameters: [
		skillNamePathParameter,
		{
			in: 'path',
			name: 'filePath',
			required: true,
			schema: { type: 'string' },
		},
		projectQueryParameter,
	],
	responses: {
		'200': jsonResponse(skillFileSchema),
		'404': errorResponse,
		'500': errorResponse,
	},
};

export const validateSkillSpec = {
	method: 'post',
	path: '/v1/skills/validate',
	tags: ['config'],
	operationId: 'validateSkill',
	summary: 'Validate a SKILL.md content',
	requestBody: {
		required: true,
		content: {
			'application/json': { schema: validateSkillRequestSchema },
		},
	},
	responses: {
		'200': jsonResponse(validateSkillResponseSchema),
	},
};

export const validateSkillNameSpec = {
	method: 'get',
	path: '/v1/skills/validate-name/{name}',
	tags: ['config'],
	operationId: 'validateSkillName',
	summary: 'Check if a skill name is valid',
	parameters: [skillNamePathParameter],
	responses: {
		'200': jsonResponse(validateNameResponseSchema),
	},
};
