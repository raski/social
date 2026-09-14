const { newId } = require('./db');

/**
 * Hämtar färsk statistik för ett enskilt inläggs alla lyckade plattformar och
 * skriver in resultatet i post.stats. Delad logik mellan enstaka/massuppdatering
 * och den dagliga automatiska ögonblicksbilden.
 */
async function refreshStatsForPost(post, profile, adapters) {
	const stats = post.stats || {};
	const errors = {};
	for (const [platform, result] of Object.entries(post.results || {})) {
		if (!result.ok || !result.id) continue;
		const adapter = adapters[platform];
		if (!adapter || !adapter.getStats) continue;
		try {
			stats[platform] = await adapter.getStats(profile.connections[platform], result.id);
		} catch (e) {
			errors[platform] = e.message;
		}
	}
	post.stats = stats;
	return errors;
}

/**
 * Slår ihop statistik över alla inlägg för en profil till en översikt: totalsummor,
 * nedbrytning per plattform, och en topplista sorterad efter totalt engagemang.
 * Bygger enbart på redan sparad (cachad) post.stats – inga nätverksanrop här.
 */
function computeDashboard(posts) {
	const perPlatform = {};
	let totalPosts = 0;
	let postsWithStats = 0;
	let postsMissingStats = 0;

	for (const post of posts) {
		if (!post.results) continue;
		const publishedToAny = Object.values(post.results).some((r) => r.ok);
		if (!publishedToAny) continue;
		totalPosts++;

		let hasAnyStat = false;
		for (const [platform, result] of Object.entries(post.results)) {
			if (!result.ok) continue;
			perPlatform[platform] = perPlatform[platform] || { postsCount: 0, likes: 0, comments: 0, shares: 0, statsAvailable: 0 };
			perPlatform[platform].postsCount++;
			const s = post.stats?.[platform];
			if (s) {
				hasAnyStat = true;
				perPlatform[platform].statsAvailable++;
				perPlatform[platform].likes += s.likes || 0;
				perPlatform[platform].comments += s.comments || 0;
				perPlatform[platform].shares += s.shares || 0;
			}
		}
		if (hasAnyStat) postsWithStats++;
		else postsMissingStats++;
	}

	const totals = { likes: 0, comments: 0, shares: 0 };
	for (const p of Object.values(perPlatform)) {
		totals.likes += p.likes;
		totals.comments += p.comments;
		totals.shares += p.shares;
	}

	const topPosts = posts
		.map((post) => {
			let engagement = 0;
			let hasStats = false;
			for (const s of Object.values(post.stats || {})) {
				engagement += (s.likes || 0) + (s.comments || 0) + (s.shares || 0);
				hasStats = true;
			}
			return { post, engagement, hasStats };
		})
		.filter((x) => x.hasStats)
		.sort((a, b) => b.engagement - a.engagement)
		.slice(0, 5)
		.map((x) => ({
			id: x.post.id,
			title: x.post.title,
			url: x.post.url,
			engagement: x.engagement,
			stats: x.post.stats,
			results: x.post.results,
		}));

	return { totalPosts, postsWithStats, postsMissingStats, perPlatform, totals, topPosts };
}

/**
 * Tar en ögonblicksbild av en profils aggregerade statistik just nu, och sparar den.
 * Körs dels automatiskt en gång per dygn (se lib/scheduler.js), dels manuellt om
 * användaren vill "börja mäta idag" istället för att vänta på nästa körning.
 */
function captureSnapshot(db, profileId, dashboard) {
	const snapshot = {
		id: newId(),
		profileId,
		capturedAt: new Date().toISOString(),
		totalPosts: dashboard.totalPosts,
		totals: dashboard.totals,
		perPlatform: Object.fromEntries(
			Object.entries(dashboard.perPlatform).map(([k, v]) => [
				k,
				{ postsCount: v.postsCount, likes: v.likes, comments: v.comments, shares: v.shares },
			])
		),
	};
	db.data.snapshots.push(snapshot);
	return snapshot;
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30, year: 365 };

/**
 * Hittar den ögonblicksbild vars capturedAt ligger närmast ett visst antal dagar
 * bakåt från `fromDate`. Kräver att träffen ligger inom halva periodlängden bort,
 * annars räknas den som "för osäker" och ignoreras (ger null).
 */
function findSnapshotNear(snapshots, fromDate, daysAgo, toleranceDays) {
	const target = new Date(fromDate.getTime() - daysAgo * 86400000);
	let best = null;
	let bestDiff = Infinity;
	for (const s of snapshots) {
		const diff = Math.abs(new Date(s.capturedAt).getTime() - target.getTime());
		if (diff < bestDiff) {
			bestDiff = diff;
			best = s;
		}
	}
	return bestDiff <= toleranceDays * 86400000 ? best : null;
}

function snapshotDelta(earlier, later) {
	if (!earlier || !later) return null;
	return {
		posts: later.totalPosts - earlier.totalPosts,
		likes: later.totals.likes - earlier.totals.likes,
		comments: later.totals.comments - earlier.totals.comments,
		shares: later.totals.shares - earlier.totals.shares,
	};
}

function pctChange(curr, prev) {
	if (prev === 0) return curr === 0 ? 0 : null; // Odefinierad tillväxt från noll (undvik dela-med-noll).
	return Math.round(((curr - prev) / Math.abs(prev)) * 1000) / 10;
}

/**
 * Beräknar en period-rapport (dag/vecka/månad/år) för en profil: förändring under
 * perioden, plus jämförelse mot en lika lång föregående period – när det finns
 * tillräckligt med sparad historik för det. Bygger på lib/scheduler.js dagliga
 * ögonblicksbilder, inte live-data (annars går det inte att jämföra mot förr).
 */
function computeReport(db, profileId, period) {
	const days = PERIOD_DAYS[period] || 7;
	const snapshots = db.data.snapshots
		.filter((s) => s.profileId === profileId)
		.sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));

	if (snapshots.length === 0) {
		return { available: false, period };
	}

	const latest = snapshots[snapshots.length - 1];
	const now = new Date(latest.capturedAt);
	const tolerance = Math.max(1, days / 2);

	const periodStart = findSnapshotNear(snapshots, now, days, tolerance);
	const prevPeriodStart = periodStart ? findSnapshotNear(snapshots, now, days * 2, tolerance) : null;

	// Om "periodens start" råkar landa på samma ögonblicksbild som den senaste (kan hända om
	// det bara finns en enda sparad ögonblicksbild än) är det ingen riktig jämförelsepunkt –
	// räkna det som otillräcklig historik istället för en missvisande "0% förändring".
	const validPeriodStart = periodStart && periodStart.id !== latest.id ? periodStart : null;
	const validPrevPeriodStart = prevPeriodStart && validPeriodStart && prevPeriodStart.id !== validPeriodStart.id ? prevPeriodStart : null;

	const thisPeriod = validPeriodStart ? snapshotDelta(validPeriodStart, latest) : null;
	const prevPeriod = validPrevPeriodStart && validPeriodStart ? snapshotDelta(validPrevPeriodStart, validPeriodStart) : null;

	const comparison = thisPeriod && prevPeriod
		? {
			posts: pctChange(thisPeriod.posts, prevPeriod.posts),
			likes: pctChange(thisPeriod.likes, prevPeriod.likes),
			comments: pctChange(thisPeriod.comments, prevPeriod.comments),
			shares: pctChange(thisPeriod.shares, prevPeriod.shares),
		}
		: null;

	return {
		available: true,
		period,
		latestSnapshotAt: latest.capturedAt,
		oldestSnapshotAt: snapshots[0].capturedAt,
		current: { totalPosts: latest.totalPosts, totals: latest.totals, perPlatform: latest.perPlatform },
		thisPeriod,
		comparison,
	};
}

module.exports = { refreshStatsForPost, computeDashboard, captureSnapshot, computeReport, PERIOD_DAYS };
