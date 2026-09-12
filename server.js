require('dotenv').config();
const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');

const { getDb, newId } = require('./lib/db');
const { fetchMetadata } = require('./lib/metadata');
const { fetchGoogleFont } = require('./lib/fonts');
const { buildPreview, publishToSelectedPlatforms } = require('./lib/publisher');
const { startScheduler } = require('./lib/scheduler');

const facebook = require('./lib/platforms/facebook');
const x = require('./lib/platforms/x');
const mastodon = require('./lib/platforms/mastodon');
const bluesky = require('./lib/platforms/bluesky');
const threads = require('./lib/platforms/threads');
const linkedin = require('./lib/platforms/linkedin');

const TESTABLE = { facebook, x, mastodon, bluesky, threads, linkedin };

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const FONTS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'fonts');

if (!ADMIN_PASSWORD) {
	console.warn('[VARNING] Ingen ADMIN_PASSWORD satt i .env – tjänsten är helt oskyddad! Sätt ett lösenord innan du exponerar den mot internet.');
}

app.use(express.json({ limit: '5mb' }));
app.use(session({
	secret: SESSION_SECRET,
	resave: false,
	saveUninitialized: false,
	cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 dagar
}));

// ---------- Autentisering ----------

function requireAuth(req, res, next) {
	if (!ADMIN_PASSWORD || req.session.authed) return next();
	if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
		return res.status(401).json({ error: 'Inte inloggad.' });
	}
	return res.redirect('/login.html');
}

app.post('/api/login', (req, res) => {
	if (!ADMIN_PASSWORD || req.body.password === ADMIN_PASSWORD) {
		req.session.authed = true;
		return res.json({ ok: true });
	}
	res.status(401).json({ error: 'Fel lösenord.' });
});
app.post('/api/logout', (req, res) => {
	req.session.destroy(() => res.json({ ok: true }));
});

app.use((req, res, next) => {
	// Låt inloggningssidan och dess kringresurser alltid vara nåbara utan inloggning.
	const publicPaths = ['/login.html', '/api/login', '/style.css', '/manifest.json'];
	if (publicPaths.includes(req.path) || req.path.startsWith('/icons/') || req.path.startsWith('/assets/')) return next();
	requireAuth(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Profiler ----------

app.get('/api/profiles', async (req, res) => {
	const db = await getDb();
	res.json(db.data.profiles);
});

app.post('/api/profiles', async (req, res) => {
	const db = await getDb();
	const profile = {
		id: newId(),
		name: req.body.name || 'Ny profil',
		createdAt: new Date().toISOString(),
		connections: {},
		settings: {
			ai: { apiKey: '', model: 'gpt-4o-mini', level: 'medium' },
			image: { layout: 'overlay', fontSizePct: 6, maxLines: 4, fontColor: '#ffffff', overlayColor: '#000000', overlayOpacity: 55, position: 'bottom' },
			facebook: { linkLine: 'Länk i kommentarerna ⬇️', commentPrefix: '🚦' },
		},
	};
	db.data.profiles.push(profile);
	await db.write();
	res.json(profile);
});

app.get('/api/profiles/:id', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	res.json(profile);
});

app.put('/api/profiles/:id', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	if (req.body.name !== undefined) profile.name = req.body.name;
	if (req.body.settings) profile.settings = { ...profile.settings, ...req.body.settings };
	await db.write();
	res.json(profile);
});

app.delete('/api/profiles/:id', async (req, res) => {
	const db = await getDb();
	db.data.profiles = db.data.profiles.filter((p) => p.id !== req.params.id);
	await db.write();
	res.json({ ok: true });
});

// ---------- Plattformskopplingar ----------

app.put('/api/profiles/:id/connections/:platform', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	profile.connections[req.params.platform] = { ...profile.connections[req.params.platform], ...req.body };
	await db.write();
	res.json(profile.connections[req.params.platform]);
});

app.post('/api/profiles/:id/connections/:platform/test', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	const adapter = TESTABLE[req.params.platform];
	if (!adapter) return res.status(400).json({ error: 'Okänd plattform.' });
	const creds = req.body && Object.keys(req.body).length ? req.body : profile.connections[req.params.platform];
	if (!creds) return res.status(400).json({ error: 'Inga uppgifter att testa.' });
	try {
		const message = await adapter.testConnection(creds);
		res.json({ ok: true, message });
	} catch (e) {
		res.status(400).json({ ok: false, error: e.message });
	}
});

// ---------- LinkedIn OAuth2-flöde ----------

app.get('/auth/linkedin/start/:profileId', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.profileId);
	if (!profile || !profile.connections?.linkedin?.clientId) {
		return res.status(400).send('Ange Client ID, Client Secret och Redirect URI för LinkedIn innan du ansluter.');
	}
	const state = newId();
	db.data.oauthStates.push({ state, profileId: profile.id, createdAt: Date.now() });
	// Städa bort gamla states (äldre än 1 timme).
	db.data.oauthStates = db.data.oauthStates.filter((s) => Date.now() - s.createdAt < 3600000);
	await db.write();

	const appCreds = profile.connections.linkedin;
	res.redirect(linkedin.buildAuthorizationUrl(appCreds, state));
});

app.get('/auth/linkedin/callback', async (req, res) => {
	const { code, state, error, error_description } = req.query;
	const db = await getDb();
	const stateEntry = db.data.oauthStates.find((s) => s.state === state);
	if (!stateEntry) return res.status(400).send('Ogiltigt eller utgånget state-värde. Försök ansluta LinkedIn igen från appen.');
	db.data.oauthStates = db.data.oauthStates.filter((s) => s.state !== state);

	if (error) {
		await db.write();
		return res.status(400).send(`LinkedIn nekade åtkomst: ${error_description || error}`);
	}

	const profile = db.data.profiles.find((p) => p.id === stateEntry.profileId);
	if (!profile) return res.status(404).send('Profilen finns inte längre.');

	try {
		const appCreds = profile.connections.linkedin;
		const tokenData = await linkedin.exchangeCodeForToken(appCreds, code);
		const { id: personId, name } = await linkedin.fetchPersonId(tokenData.access_token);

		profile.connections.linkedin = {
			...appCreds,
			accessToken: tokenData.access_token,
			expiresAt: Date.now() + (tokenData.expires_in || 0) * 1000,
			personId,
			personName: name,
			enabled: true,
		};
		await db.write();
		res.redirect(`/#/profile/${profile.id}?linkedin=connected`);
	} catch (e) {
		res.status(500).send(`Kunde inte slutföra LinkedIn-anslutningen: ${e.message}`);
	}
});

// ---------- Typsnitt (Google Fonts) ----------

app.post('/api/profiles/:id/font', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	try {
		const { family, weight } = req.body;
		const result = await fetchGoogleFont(family, weight || '700', FONTS_DIR);
		profile.settings.image = profile.settings.image || {};
		profile.settings.image.fontPath = result.path;
		profile.settings.image.fontLabel = result.label;
		await db.write();
		res.json(result);
	} catch (e) {
		res.status(400).json({ error: e.message });
	}
});

// ---------- Förhandsgranskning & publicering ----------

app.post('/api/preview', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.body.profileId);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });
	try {
		const meta = await fetchMetadata(req.body.url);
		const preview = await buildPreview(profile, meta);
		res.json({ ...preview, metaImage: meta.image });
	} catch (e) {
		res.status(400).json({ error: e.message });
	}
});

app.post('/api/publish', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.body.profileId);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });

	const { url, title, imageHeadline, metaImage, platforms, scheduledAt } = req.body;
	if (!url || !title || !Array.isArray(platforms) || platforms.length === 0) {
		return res.status(400).json({ error: 'url, title och minst en plattform krävs.' });
	}

	const post = {
		id: newId(),
		profileId: profile.id,
		url, title, imageHeadline, metaImage, platforms,
		createdAt: new Date().toISOString(),
		scheduledAt: scheduledAt || null,
		status: scheduledAt ? 'scheduled' : 'publishing',
		results: null,
		publishedAt: null,
	};
	db.data.posts.push(post);
	await db.write();

	if (scheduledAt) {
		return res.json({ ok: true, scheduled: true, post });
	}

	try {
		const results = await publishToSelectedPlatforms(profile, { url, title, imageHeadline, platforms, metaImage });
		post.results = results;
		post.status = Object.values(results).every((r) => r.ok) ? 'done' : 'partial_error';
	} catch (e) {
		post.status = 'error';
		post.error = e.message;
	}
	post.publishedAt = new Date().toISOString();
	await db.write();
	res.json({ ok: true, scheduled: false, post });
});

app.get('/api/posts', async (req, res) => {
	const db = await getDb();
	let posts = db.data.posts;
	if (req.query.profileId) posts = posts.filter((p) => p.profileId === req.query.profileId);
	posts = [...posts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
	res.json(posts);
});

app.delete('/api/posts/:id', async (req, res) => {
	const db = await getDb();
	const idx = db.data.posts.findIndex((p) => p.id === req.params.id);
	if (idx === -1) {
		return res.json({ ok: true }); // Redan borta.
	}
	db.data.posts.splice(idx, 1);
	// Städa även bort ev. lokalt sparade kommentarer kopplade till det här inlägget,
	// annars blir de kvar som spöklänkar i kommentatörsöversikten.
	db.data.comments = db.data.comments.filter((c) => c.postId !== req.params.id);
	await db.write();
	res.json({ ok: true });
});

app.post('/api/posts/:id/publish-now', async (req, res) => {
	const db = await getDb();
	const post = db.data.posts.find((p) => p.id === req.params.id);
	if (!post) return res.status(404).json({ error: 'Inlägget hittades inte.' });
	if (post.status !== 'scheduled') {
		return res.status(400).json({ error: 'Bara schemalagda inlägg kan publiceras i förtid.' });
	}
	const profile = db.data.profiles.find((p) => p.id === post.profileId);
	if (!profile) return res.status(404).json({ error: 'Profilen finns inte längre.' });

	post.status = 'publishing';
	await db.write();

	try {
		const results = await publishToSelectedPlatforms(profile, {
			url: post.url,
			title: post.title,
			imageHeadline: post.imageHeadline,
			platforms: post.platforms,
			metaImage: post.metaImage,
		});
		post.results = results;
		post.status = Object.values(results).every((r) => r.ok) ? 'done' : 'partial_error';
	} catch (e) {
		post.status = 'error';
		post.error = e.message;
	}
	post.publishedAt = new Date().toISOString();
	await db.write();
	res.json({ ok: true, post });
});

// ---------- Statistik (gillamarkeringar/kommentarer/delningar) ----------

/**
 * Hämtar färsk statistik för ett enskilt inläggs alla lyckade plattformar och
 * skriver in resultatet i post.stats. Delad logik mellan enstaka och massuppdatering.
 */
async function refreshStatsForPost(post, profile) {
	const stats = post.stats || {};
	const errors = {};
	for (const [platform, result] of Object.entries(post.results || {})) {
		if (!result.ok || !result.id) continue;
		const adapter = TESTABLE[platform];
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

app.post('/api/posts/:id/refresh-stats', async (req, res) => {
	const db = await getDb();
	const post = db.data.posts.find((p) => p.id === req.params.id);
	if (!post) return res.status(404).json({ error: 'Inlägget hittades inte.' });
	const profile = db.data.profiles.find((p) => p.id === post.profileId);
	if (!profile) return res.status(404).json({ error: 'Profilen finns inte längre.' });

	const errors = await refreshStatsForPost(post, profile);
	await db.write();
	res.json({ ok: true, stats: post.stats, errors });
});

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

app.get('/api/profiles/:id/dashboard', async (req, res) => {
	const db = await getDb();
	const posts = db.data.posts.filter((p) => p.profileId === req.params.id);
	res.json(computeDashboard(posts));
});

app.post('/api/profiles/:id/dashboard/refresh', async (req, res) => {
	const db = await getDb();
	const profile = db.data.profiles.find((p) => p.id === req.params.id);
	if (!profile) return res.status(404).json({ error: 'Profilen hittades inte.' });

	const posts = db.data.posts.filter((p) => p.profileId === req.params.id && p.results && Object.values(p.results).some((r) => r.ok));
	const errors = {};
	for (const post of posts) {
		const postErrors = await refreshStatsForPost(post, profile);
		if (Object.keys(postErrors).length) errors[post.id] = postErrors;
	}
	await db.write();
	res.json({ ok: true, dashboard: computeDashboard(posts), errors });
});

// ---------- Facebook-kommentarer (läsning + "minne" per person) ----------

app.post('/api/posts/:id/fetch-comments', async (req, res) => {
	const db = await getDb();
	const post = db.data.posts.find((p) => p.id === req.params.id);
	if (!post) return res.status(404).json({ error: 'Inlägget hittades inte.' });
	const profile = db.data.profiles.find((p) => p.id === post.profileId);
	if (!profile) return res.status(404).json({ error: 'Profilen finns inte längre.' });

	const fbResult = post.results?.facebook;
	if (!fbResult || !fbResult.ok) {
		return res.status(400).json({ error: 'Det här inlägget postades inte till Facebook (eller misslyckades).' });
	}

	try {
		const comments = await facebook.getComments(profile.connections.facebook, fbResult.id);

		// Spara/uppdatera varje kommentar lokalt, så vi bygger upp ett "minne" över tid
		// (dedupliceras på kommentarens Facebook-ID).
		for (const c of comments) {
			const existing = db.data.comments.find((x) => x.id === c.id);
			const record = {
				id: c.id,
				postId: post.id,
				profileId: profile.id,
				fbPostId: fbResult.id,
				fromId: c.fromId,
				fromName: c.fromName,
				message: c.message,
				createdTime: c.createdTime,
				fetchedAt: new Date().toISOString(),
				raw: c.raw || null,
			};
			if (existing) Object.assign(existing, record);
			else db.data.comments.push(record);
		}
		await db.write();

		res.json({ ok: true, comments });
	} catch (e) {
		res.status(400).json({ error: e.message });
	}
});

app.get('/api/profiles/:id/commenters', async (req, res) => {
	const db = await getDb();
	const comments = db.data.comments.filter((c) => c.profileId === req.params.id && c.fromId);

	const byPerson = new Map();
	for (const c of comments) {
		if (!byPerson.has(c.fromId)) {
			byPerson.set(c.fromId, { fromId: c.fromId, fromName: c.fromName, count: 0, lastCommentAt: c.createdTime });
		}
		const entry = byPerson.get(c.fromId);
		entry.count += 1;
		if (new Date(c.createdTime) > new Date(entry.lastCommentAt)) {
			entry.lastCommentAt = c.createdTime;
			entry.fromName = c.fromName; // Använd senaste kända namnet (kan ändras över tid).
		}
	}

	const list = [...byPerson.values()].sort((a, b) => b.count - a.count);
	res.json(list);
});

app.get('/api/profiles/:id/commenters/:fromId', async (req, res) => {
	const db = await getDb();
	const comments = db.data.comments
		.filter((c) => c.profileId === req.params.id && c.fromId === req.params.fromId)
		.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

	// Slå ihop med vilket inlägg (rubrik/länk) varje kommentar hörde till, för sammanhang.
	const enriched = comments.map((c) => {
		const post = db.data.posts.find((p) => p.id === c.postId);
		return { ...c, postTitle: post?.title || '(okänt inlägg)', postUrl: post?.url || null };
	});

	res.json(enriched);
});

// ---------- PWA share target (för Android "Dela till"-menyn) ----------

app.get('/share-target', (req, res) => {
	const candidate = req.query.url || req.query.text || req.query.title || '';
	const match = String(candidate).match(/https?:\/\/[^\s]+/);
	const sharedUrl = match ? match[0] : '';
	res.redirect(`/#/new?url=${encodeURIComponent(sharedUrl)}`);
});

app.listen(PORT, () => {
	console.log(`Social Poster igång på port ${PORT}`);
	startScheduler();
});
