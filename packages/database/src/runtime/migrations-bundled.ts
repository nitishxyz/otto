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
import mig0010 from '../../drizzle/0010_aberrant_hellion.sql' with {
	type: 'text',
};
import mig0011 from '../../drizzle/0011_dedupe_message_part_index.sql' with {
	type: 'text',
};
import mig0012 from '../../drizzle/0012_message_sequence_and_checkpoint_boundary.sql' with {
	type: 'text',
};
import mig0013 from '../../drizzle/0013_backfill_message_sequence.sql' with {
	type: 'text',
};
import mig0014 from '../../drizzle/0014_dedupe_running_subagents.sql' with {
	type: 'text',
};
import mig0015 from '../../drizzle/0015_subagent_attempt_delivery.sql' with {
	type: 'text',
};
import mig0016 from '../../drizzle/0016_backfill_subagent_delivery_state.sql' with {
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
	{ name: '0010_aberrant_hellion.sql', content: mig0010 },
	{ name: '0011_dedupe_message_part_index.sql', content: mig0011 },
	{
		name: '0012_message_sequence_and_checkpoint_boundary.sql',
		content: mig0012,
	},
	{ name: '0013_backfill_message_sequence.sql', content: mig0013 },
	{ name: '0014_dedupe_running_subagents.sql', content: mig0014 },
	{ name: '0015_subagent_attempt_delivery.sql', content: mig0015 },
	{ name: '0016_backfill_subagent_delivery_state.sql', content: mig0016 },
];
