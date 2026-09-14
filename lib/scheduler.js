const cron = require('node-cron');
const { getDb } = require('./db');
const { publishToSelectedPlatforms } = require('./publisher');
const { refreshStatsForPost, computeDashboard, captureSnapshot } = require('./report');

const facebook = require('./platforms/facebook');
const x = require('./platforms/x');
const mastodon = require('./platforms/mastodon');
const bluesky = require('./platforms/bluesky');
const threads = require('./platforms/threads');
const linkedin = require('./platforms/linkedin');
const ADAPTERS = { facebook, x, mastodon, bluesky, threads, linkedin };

/**
 * Startar bakgrundsprocesser: dels minutliga kollar av schemalagda inlägg, dels en
 * daglig ögonblicksbild av statistiken (för dag/vecka/månad/år-rapporterna).
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

	// Körs en gång per dygn (00:05 UTC – exakt klockslag spelar ingen roll för
	// period-jämförelserna, de tolererar viss avvikelse).
	cron.schedule('5 0 * * *', async () => {
		try {
			await runDailySnapshot();
		} catch (e) {
			console.error('[scheduler] Fel vid daglig ögonblicksbild:', e);
		}
	});
	console.log('[scheduler] Daglig statistik-ögonblicksbild schemalagd till 00:05 UTC.');
}

/**
 * Uppdaterar statistik för alla publicerade inlägg och sparar en ögonblicksbild av
 * det aggregerade läget, en gång per profil. Fel för enskilda plattformar/inlägg
 * hoppas tyst över (samma som vid manuell uppdatering) – en trasig token för en
 * profil ska inte stoppa ögonblicksbilden för alla andra profiler.
 */
async function runDailySnapshot() {
	const db = await getDb();
	for (const profile of db.data.profiles) {
		const posts = db.data.posts.filter(
			(p) => p.profileId === profile.id && p.results && Object.values(p.results).some((r) => r.ok)
		);
		for (const post of posts) {
			try {
				await refreshStatsForPost(post, profile, ADAPTERS);
			} catch (e) {
				// Enskilda plattformsfel hanteras redan inuti refreshStatsForPost (returneras som
				// errors, inte kastas) – den här catchen är bara ett extra skyddsnät.
			}
		}
		const dashboard = computeDashboard(posts);
		captureSnapshot(db, profile.id, dashboard);
	}
	await db.write();
	console.log(`[scheduler] Daglig ögonblicksbild klar för ${db.data.profiles.length} profil(er).`);
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

module.exports = { startScheduler, runDueJobs, runDailySnapshot };
