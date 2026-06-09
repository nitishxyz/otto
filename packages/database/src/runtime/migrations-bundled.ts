import mig0000 from '../../drizzle/0000_material_swarm.sql' with {
	type: 'text',
};
import mig0001 from '../../drizzle/0001_elite_ego.sql' with { type: 'text' };
import mig0002 from '../../drizzle/0002_flawless_stature.sql' with {
	type: 'text',
};
import mig0003 from '../../drizzle/0003_public_ted_forrester.sql' with {
	type: 'text',
};

export const bundledMigrations: Array<{ name: string; content: string }> = [
	{ name: '0000_material_swarm.sql', content: mig0000 },
	{ name: '0001_elite_ego.sql', content: mig0001 },
	{ name: '0002_flawless_stature.sql', content: mig0002 },
	{ name: '0003_public_ted_forrester.sql', content: mig0003 },
];
