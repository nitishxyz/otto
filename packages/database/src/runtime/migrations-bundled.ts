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
import mig0004 from '../../drizzle/0004_damp_ted_forrester.sql' with {
	type: 'text',
};
import mig0005 from '../../drizzle/0005_majestic_paibok.sql' with {
	type: 'text',
};
import mig0006 from '../../drizzle/0006_wild_magus.sql' with { type: 'text' };
import mig0007 from '../../drizzle/0007_drop_done_pending_status.sql' with {
	type: 'text',
};
import mig0008 from '../../drizzle/0008_quick_screwball.sql' with {
	type: 'text',
};
import mig0009 from '../../drizzle/0009_tearful_roland_deschain.sql' with {
	type: 'text',
};

export const bundledMigrations: Array<{ name: string; content: string }> = [
	{ name: '0000_material_swarm.sql', content: mig0000 },
	{ name: '0001_elite_ego.sql', content: mig0001 },
	{ name: '0002_flawless_stature.sql', content: mig0002 },
	{ name: '0003_public_ted_forrester.sql', content: mig0003 },
	{ name: '0004_damp_ted_forrester.sql', content: mig0004 },
	{ name: '0005_majestic_paibok.sql', content: mig0005 },
	{ name: '0006_wild_magus.sql', content: mig0006 },
	{ name: '0007_drop_done_pending_status.sql', content: mig0007 },
	{ name: '0008_quick_screwball.sql', content: mig0008 },
	{ name: '0009_tearful_roland_deschain.sql', content: mig0009 },
];
