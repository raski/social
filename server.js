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
			image: { fontSizePct: 6, maxLines: 4, fontColor: '#ffffff', overlayColor: '#000000', overlayOpacity: 55, position: 'bottom' },
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
	const post = db.data.posts.find((p) => p.id === req.params.id);
	if (post && post.status === 'scheduled') {
		post.status = 'cancelled';
		await db.write();
	}
	res.json({ ok: true });
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
