import mig0000 from '../../drizzle/0000_material_swarm.sql' with {
	type: 'text',
};
import mig0001 from '../../drizzle/0001_elite_ego.sql' with { type: 'text' };

export const bundledMigrations: Array<{ name: string; content: string }> = [
	{ name: '0000_material_swarm.sql', content: mig0000 },
	{ name: '0001_elite_ego.sql', content: mig0001 },
];
