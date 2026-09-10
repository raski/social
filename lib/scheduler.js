const cron = require('node-cron');
const { getDb } = require('./db');
const { publishToSelectedPlatforms } = require('./publisher');

/**
 * Startar en bakgrundsprocess som varje minut kollar om något schemalagt inlägg
 * har förfallit (scheduledAt <= nu) och i så fall publicerar det.
 */
function startScheduler() {
	cron.schedule('* * * * *', async () => {
		try {
			await runDueJobs();
		} catch (e) {
			console.error('[scheduler] Oväntat fel:', e);
		}
	});
	console.log('[scheduler] Startad, kollar schemalagda inlägg varje minut.');
}

async function runDueJobs() {
	const db = await getDb();
	const now = Date.now();

	const due = db.data.posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() <= now);
	if (due.length === 0) return;

	for (const post of due) {
		post.status = 'publishing';
		await db.write();

		const profile = db.data.profiles.find((pr) => pr.id === post.profileId);
		if (!profile) {
			post.status = 'error';
			post.error = 'Profilen finns inte längre.';
			await db.write();
			continue;
		}

		try {
			const results = await publishToSelectedPlatforms(profile, {
				url: post.url,
				title: post.title,
				imageHeadline: post.imageHeadline,
				platforms: post.platforms,
				metaImage: post.metaImage,
			});
			post.results = results;
			const allOk = Object.values(results).every((r) => r.ok);
			post.status = allOk ? 'done' : 'partial_error';
		} catch (e) {
			post.status = 'error';
			post.error = e.message;
		}
		post.publishedAt = new Date().toISOString();
		await db.write();
	}
}

module.exports = { startScheduler, runDueJobs };
