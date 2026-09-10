// ====================== Hjälpfunktioner ======================

async function api(method, url, body) {
	const res = await fetch(url, {
		method,
		headers: body ? { 'Content-Type': 'application/json' } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	let data = null;
	try { data = await res.json(); } catch (e) { /* tomt svar */ }
	if (!res.ok) {
		const message = (data && (data.error || data.message)) || `Fel (HTTP ${res.status})`;
		throw new Error(message);
	}
	return data;
}

function el(html) {
	const t = document.createElement('template');
	t.innerHTML = html.trim();
	return t.content.firstElementChild;
}

function escapeHtml(str) {
	return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function parseHash() {
	const hash = window.location.hash.replace(/^#\/?/, '');
	const [path, queryStr] = hash.split('?');
	const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
	return { path: path || '', parts: path ? path.split('/') : [], query };
}

const PLATFORM_LABELS = {
	facebook: 'Facebook', x: 'X', mastodon: 'Mastodon', bluesky: 'Bluesky', threads: 'Threads', linkedin: 'LinkedIn',
};

// ====================== Router ======================

document.getElementById('logout-btn')?.addEventListener('click', async () => {
	await api('POST', '/api/logout');
	window.location.href = '/login.html';
});

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

async function render() {
	const app = document.getElementById('app');
	const { path, parts, query } = parseHash();
	app.innerHTML = '<p class="muted">Laddar…</p>';

	try {
		if (path === '' || path === '/') return renderProfilesList(app);
		if (parts[0] === 'profile' && parts[2] === 'new') return renderNewPost(app, parts[1], query);
		if (parts[0] === 'profile' && parts[2] === 'history') return renderHistory(app, parts[1]);
		if (parts[0] === 'profile' && parts[2] === 'commenters' && parts.length === 3) return renderCommentersOverview(app, parts[1]);
		if (parts[0] === 'profile' && parts[2] === 'commenters' && parts.length === 4) return renderCommenterDetail(app, parts[1], parts[3]);
		if (parts[0] === 'profile' && parts[2] === 'comments') return renderCommentsHub(app, parts[1], query.post || null);
		if (parts[0] === 'profile' && parts.length === 2) return renderProfileDetail(app, parts[1], query);
		if (parts[0] === 'new') return renderNewPost(app, query.profileId || null, query);
		if (parts[0] === 'history') return renderHistory(app, null);
		app.innerHTML = '<p class="empty-state">Sidan hittades inte.</p>';
	} catch (e) {
		app.innerHTML = `<div class="card"><p style="color:var(--danger)">Fel: ${escapeHtml(e.message)}</p></div>`;
	}
}

// ====================== Profillista ======================

async function renderProfilesList(app) {
	const profiles = await api('GET', '/api/profiles');
	app.innerHTML = '';

	const toolbar = el(`
		<div class="toolbar">
			<h1 class="section-title" style="margin:0;">Profiler</h1>
			<button class="btn btn-primary" id="add-profile-btn">+ Ny profil</button>
		</div>
	`);
	app.appendChild(toolbar);

	if (profiles.length === 0) {
		app.appendChild(el(`<div class="empty-state">Inga profiler ännu. Skapa en för att komma igång – t.ex. en per sajt.</div>`));
	}

	for (const p of profiles) {
		const connectedCount = Object.values(p.connections || {}).filter((c) => c && c.enabled).length;
		const item = el(`
			<a href="#/profile/${p.id}" class="profile-list-item">
				<div>
					<div class="name">${escapeHtml(p.name)}</div>
					<div class="meta">${connectedCount} plattform${connectedCount === 1 ? '' : 'ar'} kopplade</div>
				</div>
				<span>›</span>
			</a>
		`);
		app.appendChild(item);
	}

	document.getElementById('add-profile-btn').addEventListener('click', async () => {
		const name = prompt('Namn på profilen (t.ex. sajtens namn):');
		if (!name) return;
		const profile = await api('POST', '/api/profiles', { name });
		window.location.hash = `#/profile/${profile.id}`;
	});
}

// ====================== Profildetalj: kopplingar + inställningar ======================

const PLATFORM_FIELDS = {
	facebook: [
		{ key: 'pageId', label: 'Facebook Page ID', type: 'text' },
		{ key: 'accessToken', label: 'Sidans åtkomsttoken (permanent)', type: 'password' },
	],
	x: [
		{ key: 'apiKey', label: 'API Key', type: 'password' },
		{ key: 'apiSecret', label: 'API Key Secret', type: 'password' },
		{ key: 'accessToken', label: 'Access Token', type: 'password' },
		{ key: 'accessTokenSecret', label: 'Access Token Secret', type: 'password' },
	],
	mastodon: [
		{ key: 'instanceUrl', label: 'Instans-URL (t.ex. https://mastodon.social)', type: 'text' },
		{ key: 'accessToken', label: 'Åtkomsttoken', type: 'password' },
	],
	bluesky: [
		{ key: 'handle', label: 'Handle (t.ex. dittnamn.bsky.social)', type: 'text' },
		{ key: 'appPassword', label: 'App-lösenord', type: 'password' },
	],
	threads: [
		{ key: 'userId', label: 'Threads User ID', type: 'text' },
		{ key: 'accessToken', label: 'Åtkomsttoken', type: 'password' },
	],
};

async function renderProfileDetail(app, profileId, query) {
	const profile = await api('GET', `/api/profiles/${profileId}`);
	app.innerHTML = '';

	if (query.linkedin === 'connected') {
		app.appendChild(el(`<div class="card" style="border-color:var(--success);"><strong style="color:var(--success);">✅ LinkedIn anslutet!</strong></div>`));
	}

	const activeTab = query.tab === 'settings' ? 'settings' : 'history';

	const header = el(`
		<div>
			<div class="toolbar">
				<a href="#/" class="muted" style="text-decoration:none;">← Alla profiler</a>
				<h1 class="section-title" style="margin:4px 0 0;">${escapeHtml(profile.name)}</h1>
			</div>
			<div class="tab-bar" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;">
				<a href="#/profile/${profile.id}?tab=history" class="tab-link ${activeTab === 'history' ? 'active' : ''}">Historik</a>
				<a href="#/profile/${profile.id}?tab=settings" class="tab-link ${activeTab === 'settings' ? 'active' : ''}">Inställningar</a>
			</div>
		</div>
	`);
	app.appendChild(header);

	if (activeTab === 'settings') {
		app.appendChild(renderProfileSettings(profile));
	} else {
		renderNewPostForm(app, profile.id);
		const historyContainer = el('<div id="embedded-history"></div>');
		app.appendChild(historyContainer);
		await renderPostList(historyContainer, profile.id, { showCommentersLink: true });
	}
}

function renderProfileSettings(profile) {
	const container = el('<div></div>');

	// -------- Plattformskopplingar --------
	const platformsSection = el(`<div class="card"><h2>Kopplade konton</h2><div class="platform-grid" id="platform-grid"></div></div>`);
	container.appendChild(platformsSection);
	const grid = platformsSection.querySelector('#platform-grid');

	for (const key of Object.keys(PLATFORM_FIELDS)) {
		grid.appendChild(renderPlatformCard(profile, key));
	}
	grid.appendChild(renderLinkedInCard(profile));

	// -------- Inställningar: AI --------
	const ai = profile.settings?.ai || {};
	const aiCard = el(`
		<div class="card">
			<h2>Lockande rubrik (AI, bara för bilden på Facebook)</h2>
			<div class="field">
				<label>OpenAI API-nyckel</label>
				<input type="password" id="ai-key" value="${escapeHtml(ai.apiKey || '')}" placeholder="Lämna tomt för att använda originalrubriken" />
			</div>
			<div class="row">
				<div class="field">
					<label>Modell</label>
					<input type="text" id="ai-model" value="${escapeHtml(ai.model || 'gpt-4o-mini')}" />
				</div>
				<div class="field">
					<label>Klickvänlighetsnivå</label>
					<select id="ai-level">
						<option value="low" ${ai.level === 'low' ? 'selected' : ''}>Låg</option>
						<option value="medium" ${(!ai.level || ai.level === 'medium') ? 'selected' : ''}>Medel</option>
						<option value="high" ${ai.level === 'high' ? 'selected' : ''}>Hög</option>
					</select>
				</div>
			</div>
			<button class="btn btn-secondary btn-sm" id="save-ai">Spara</button>
			<span class="test-result" id="ai-save-result"></span>
		</div>
	`);
	container.appendChild(aiCard);
	aiCard.querySelector('#save-ai').addEventListener('click', async () => {
		await saveSettings(profile.id, {
			ai: {
				apiKey: aiCard.querySelector('#ai-key').value,
				model: aiCard.querySelector('#ai-model').value,
				level: aiCard.querySelector('#ai-level').value,
			},
		});
		showResult(aiCard.querySelector('#ai-save-result'), true, 'Sparat!');
	});

	// -------- Inställningar: Facebook-text --------
	const fb = profile.settings?.facebook || {};
	const fbCard = el(`
		<div class="card">
			<h2>Text på Facebook-inlägget</h2>
			<div class="field">
				<label>Rad om länk i kommentarerna</label>
				<input type="text" id="fb-linkline" value="${escapeHtml(fb.linkLine || 'Länk i kommentarerna ⬇️')}" />
			</div>
			<div class="field">
				<label>Emoji/prefix i kommentaren</label>
				<input type="text" id="fb-commentprefix" value="${escapeHtml(fb.commentPrefix || '🚦')}" />
			</div>
			<button class="btn btn-secondary btn-sm" id="save-fb-text">Spara</button>
			<span class="test-result" id="fb-text-save-result"></span>
		</div>
	`);
	container.appendChild(fbCard);
	fbCard.querySelector('#save-fb-text').addEventListener('click', async () => {
		await saveSettings(profile.id, {
			facebook: {
				linkLine: fbCard.querySelector('#fb-linkline').value,
				commentPrefix: fbCard.querySelector('#fb-commentprefix').value,
			},
		});
		showResult(fbCard.querySelector('#fb-text-save-result'), true, 'Sparat!');
	});

	// -------- Inställningar: Bild --------
	container.appendChild(renderImageSettingsCard(profile));

	return container;
}

function showResult(elm, ok, message) {
	elm.textContent = message;
	elm.className = 'test-result ' + (ok ? 'ok' : 'fail');
	setTimeout(() => { elm.textContent = ''; }, 4000);
}

async function saveSettings(profileId, partialSettings) {
	const profile = await api('GET', `/api/profiles/${profileId}`);
	const merged = { ...profile.settings, ...partialSettings };
	// Djup-slå ihop varje undersektion så vi inte råkar radera andra fält i samma objekt.
	for (const key of Object.keys(partialSettings)) {
		merged[key] = { ...(profile.settings?.[key] || {}), ...partialSettings[key] };
	}
	await api('PUT', `/api/profiles/${profileId}`, { settings: merged });
}

function renderPlatformCard(profile, key) {
	const conn = profile.connections?.[key] || {};
	const fields = PLATFORM_FIELDS[key];
	const enabled = !!conn.enabled;

	const card = el(`
		<div class="platform-card">
			<div class="title-row">
				<span class="name">${PLATFORM_LABELS[key]}</span>
				<span class="status-pill ${enabled ? 'status-connected' : 'status-disconnected'}">${enabled ? 'Aktiverad' : 'Ej aktiverad'}</span>
			</div>
			<div class="fields"></div>
			<label style="display:flex;align-items:center;gap:6px;font-weight:400;margin-bottom:10px;">
				<input type="checkbox" id="enabled-${key}" ${enabled ? 'checked' : ''} style="width:auto;margin:0;" /> Aktivera denna plattform
			</label>
			<div style="display:flex;gap:8px;">
				<button class="btn btn-secondary btn-sm save-btn">Spara</button>
				<button class="btn btn-secondary btn-sm test-btn">Testa anslutning</button>
			</div>
			<div class="test-result"></div>
		</div>
	`);
	const fieldsDiv = card.querySelector('.fields');
	for (const f of fields) {
		fieldsDiv.appendChild(el(`
			<div class="field">
				<label>${f.label}</label>
				<input type="${f.type}" data-field="${f.key}" value="${escapeHtml(conn[f.key] || '')}" />
			</div>
		`));
	}

	function collectValues() {
		const values = { enabled: card.querySelector(`#enabled-${key}`).checked };
		fieldsDiv.querySelectorAll('input[data-field]').forEach((input) => {
			values[input.dataset.field] = input.value;
		});
		return values;
	}

	card.querySelector('.save-btn').addEventListener('click', async () => {
		try {
			await api('PUT', `/api/profiles/${profile.id}/connections/${key}`, collectValues());
			showResult(card.querySelector('.test-result'), true, 'Sparat!');
			card.querySelector('.status-pill').className = 'status-pill ' + (collectValues().enabled ? 'status-connected' : 'status-disconnected');
			card.querySelector('.status-pill').textContent = collectValues().enabled ? 'Aktiverad' : 'Ej aktiverad';
		} catch (e) {
			showResult(card.querySelector('.test-result'), false, e.message);
		}
	});

	card.querySelector('.test-btn').addEventListener('click', async () => {
		const resultEl = card.querySelector('.test-result');
		resultEl.textContent = 'Testar…';
		resultEl.className = 'test-result';
		try {
			const res = await api('POST', `/api/profiles/${profile.id}/connections/${key}/test`, collectValues());
			showResult(resultEl, true, res.message);
		} catch (e) {
			showResult(resultEl, false, e.message);
		}
	});

	return card;
}

function renderLinkedInCard(profile) {
	const conn = profile.connections?.linkedin || {};
	const connected = !!conn.accessToken && conn.enabled;

	const card = el(`
		<div class="platform-card">
			<div class="title-row">
				<span class="name">LinkedIn</span>
				<span class="status-pill ${connected ? 'status-connected' : 'status-disconnected'}">${connected ? `Ansluten (${escapeHtml(conn.personName || '')})` : 'Ej ansluten'}</span>
			</div>
			<p class="muted" style="font-size:12px;">Kräver en LinkedIn-app (developer.linkedin.com) med produkten "Share on LinkedIn". Ange dess uppgifter, klicka Spara, klicka sedan Anslut.</p>
			<div class="field"><label>Client ID</label><input type="text" data-field="clientId" value="${escapeHtml(conn.clientId || '')}" /></div>
			<div class="field"><label>Client Secret</label><input type="password" data-field="clientSecret" value="${escapeHtml(conn.clientSecret || '')}" /></div>
			<div class="field"><label>Redirect URI</label><input type="text" data-field="redirectUri" value="${escapeHtml(conn.redirectUri || (window.location.origin + '/auth/linkedin/callback'))}" /></div>
			<div style="display:flex;gap:8px;">
				<button class="btn btn-secondary btn-sm save-btn">Spara appuppgifter</button>
				<a class="btn btn-primary btn-sm" id="connect-linkedin">Anslut via LinkedIn</a>
				${connected ? '<button class="btn btn-danger btn-sm disconnect-btn">Koppla från</button>' : ''}
			</div>
			<div class="test-result"></div>
		</div>
	`);

	function collectValues() {
		const values = {};
		card.querySelectorAll('input[data-field]').forEach((input) => { values[input.dataset.field] = input.value; });
		return values;
	}

	card.querySelector('.save-btn').addEventListener('click', async () => {
		try {
			await api('PUT', `/api/profiles/${profile.id}/connections/linkedin`, collectValues());
			showResult(card.querySelector('.test-result'), true, 'Sparat! Klicka nu på "Anslut via LinkedIn".');
		} catch (e) {
			showResult(card.querySelector('.test-result'), false, e.message);
		}
	});

	card.querySelector('#connect-linkedin').addEventListener('click', (e) => {
		e.preventDefault();
		window.location.href = `/auth/linkedin/start/${profile.id}`;
	});

	card.querySelector('.disconnect-btn')?.addEventListener('click', async () => {
		await api('PUT', `/api/profiles/${profile.id}/connections/linkedin`, { enabled: false, accessToken: '', personId: '' });
		render();
	});

	return card;
}

function renderImageSettingsCard(profile) {
	const img = profile.settings?.image || {};
	const layout = img.layout || 'overlay';
	const card = el(`
		<div class="card">
			<h2>Bild med rubrik (Facebook)</h2>
			<div class="field">
				<label>Layout</label>
				<select id="img-layout">
					<option value="overlay" ${layout === 'overlay' ? 'selected' : ''}>Text ovanpå bilden (halvgenomskinlig panel)</option>
					<option value="below" ${layout === 'below' ? 'selected' : ''}>Text under bilden (vit bakgrund, svart text)</option>
					<option value="vertical" ${layout === 'vertical' ? 'selected' : ''}>Stående bild (beskuren 4:5), text ovanpå</option>
				</select>
			</div>
			<div class="field">
				<label>Aktivt typsnitt</label>
				<div class="muted" id="font-label">${escapeHtml(img.fontLabel || 'Inget eget typsnitt valt – ett enkelt inbyggt typsnitt används.')}</div>
			</div>
			<div class="row">
				<div class="field">
					<label>Hämta från Google Fonts</label>
					<input type="text" id="font-family" placeholder="t.ex. Archivo Black" />
				</div>
				<div class="field">
					<label>Vikt</label>
					<select id="font-weight">
						<option value="400">Normal (400)</option>
						<option value="700" selected>Fet (700)</option>
						<option value="900">Extra fet (900)</option>
					</select>
				</div>
			</div>
			<button class="btn btn-secondary btn-sm" id="fetch-font">Hämta typsnitt</button>
			<span class="test-result" id="font-result"></span>

			<div class="row" style="margin-top:16px;">
				<div class="field"><label>Textstorlek (% av bildbredd)</label><input type="number" id="img-size" value="${img.fontSizePct ?? 6}" min="2" max="15" /></div>
				<div class="field"><label>Max antal rader</label><input type="number" id="img-lines" value="${img.maxLines ?? 4}" min="1" max="8" /></div>
			</div>
			<div id="overlay-fields" style="${layout === 'below' ? 'display:none;' : ''}">
				<div class="row">
					<div class="field"><label>Textfärg</label><input type="text" id="img-fontcolor" value="${img.fontColor || '#ffffff'}" /></div>
					<div class="field"><label>Bakgrundsfärg</label><input type="text" id="img-overlaycolor" value="${img.overlayColor || '#000000'}" /></div>
				</div>
				<div class="row">
					<div class="field"><label>Genomskinlighet (%)</label><input type="number" id="img-opacity" value="${img.overlayOpacity ?? 55}" min="0" max="100" /></div>
					<div class="field">
						<label>Placering</label>
						<select id="img-position">
							<option value="bottom" ${(!img.position || img.position === 'bottom') ? 'selected' : ''}>Nederkant</option>
							<option value="top" ${img.position === 'top' ? 'selected' : ''}>Överkant</option>
							<option value="center" ${img.position === 'center' ? 'selected' : ''}>Mitten</option>
						</select>
					</div>
				</div>
			</div>
			<p class="muted" id="below-note" style="${layout === 'below' ? '' : 'display:none;'}font-size:12px;">"Text under bilden"-läget använder alltid vit bakgrund med svart text, så färg-/placeringsinställningarna ovan gäller inte för det läget.</p>
			<button class="btn btn-secondary btn-sm" id="save-image-settings">Spara bildinställningar</button>
			<span class="test-result" id="image-settings-result"></span>

			<h3 style="margin-top:20px;">Förhandsgranskning</h3>
			<div class="field"><label>Klistra in en riktig artikel-URL att förhandsgranska mot</label><input type="url" id="preview-url" placeholder="https://din-sajt.se/en-artikel" /></div>
			<button class="btn btn-secondary btn-sm" id="run-preview">Uppdatera förhandsgranskning</button>
			<div id="preview-output" style="margin-top:12px;"></div>
		</div>
	`);

	card.querySelector('#img-layout').addEventListener('change', (e) => {
		const isBelow = e.target.value === 'below';
		card.querySelector('#overlay-fields').style.display = isBelow ? 'none' : '';
		card.querySelector('#below-note').style.display = isBelow ? '' : 'none';
	});

	function collectImageValues() {
		return {
			layout: card.querySelector('#img-layout').value,
			fontSizePct: Number(card.querySelector('#img-size').value),
			maxLines: Number(card.querySelector('#img-lines').value),
			fontColor: card.querySelector('#img-fontcolor').value,
			overlayColor: card.querySelector('#img-overlaycolor').value,
			overlayOpacity: Number(card.querySelector('#img-opacity').value),
			position: card.querySelector('#img-position').value,
		};
	}

	card.querySelector('#save-image-settings').addEventListener('click', async () => {
		await saveSettings(profile.id, { image: collectImageValues() });
		showResult(card.querySelector('#image-settings-result'), true, 'Sparat!');
	});

	card.querySelector('#fetch-font').addEventListener('click', async () => {
		const resultEl = card.querySelector('#font-result');
		resultEl.textContent = 'Hämtar…';
		resultEl.className = 'test-result';
		try {
			const family = card.querySelector('#font-family').value;
			const weight = card.querySelector('#font-weight').value;
			const res = await api('POST', `/api/profiles/${profile.id}/font`, { family, weight });
			showResult(resultEl, true, 'Klart!');
			card.querySelector('#font-label').textContent = res.label;
		} catch (e) {
			showResult(resultEl, false, e.message);
		}
	});

	card.querySelector('#run-preview').addEventListener('click', async () => {
		const url = card.querySelector('#preview-url').value;
		const output = card.querySelector('#preview-output');
		if (!url) return;
		output.innerHTML = '<span class="spinner"></span> Genererar förhandsgranskning…';
		try {
			// Spara aktuella (ev. osparade) bildinställningar temporärt så förhandsgranskningen matchar formuläret.
			await saveSettings(profile.id, { image: collectImageValues() });
			const preview = await api('POST', '/api/preview', { profileId: profile.id, url });
			output.innerHTML = '';
			if (preview.imageBase64) {
				output.appendChild(el(`<img class="preview-image" src="${preview.imageBase64}" />`));
			} else {
				output.appendChild(el(`<p class="muted">Ingen bild kunde genereras${preview.imageError ? ': ' + escapeHtml(preview.imageError) : ''}.</p>`));
			}
			output.appendChild(el(`<p class="muted" style="margin-top:8px;">Lockande rubrik${preview.intensity ? ' (intensitet ' + preview.intensity + '/10)' : ''}: <strong>${escapeHtml(preview.imageHeadline)}</strong></p>`));
		} catch (e) {
			output.innerHTML = `<p style="color:var(--danger)">${escapeHtml(e.message)}</p>`;
		}
	});

	return card;
}

// ====================== Nytt inlägg ======================

/**
 * Kompakt "nytt inlägg"-formulär (bara URL-fält + knapp, ingen profilväljare eftersom
 * profilen redan är given av sammanhanget). Används inbäddat högst upp på en profils
 * Historik-flik, för att slippa ett extra sidbyte.
 */
function renderNewPostForm(container, profileId, prefillUrl = '') {
	const card = el(`
		<div class="card">
			<h3 style="margin-top:0;">Nytt inlägg</h3>
			<div class="field">
				<label>Länk att dela</label>
				<input type="url" id="post-url" placeholder="https://din-sajt.se/en-artikel" value="${escapeHtml(prefillUrl)}" />
			</div>
			<button class="btn btn-primary" id="fetch-preview-btn">Hämta förhandsgranskning</button>
		</div>
	`);
	container.appendChild(card);

	const resultContainer = el('<div id="new-post-result"></div>');
	container.appendChild(resultContainer);

	async function doPreview() {
		const url = card.querySelector('#post-url').value.trim();
		if (!url) return;
		resultContainer.innerHTML = '<p><span class="spinner"></span> Hämtar sidan och genererar förhandsgranskning…</p>';
		try {
			const preview = await api('POST', '/api/preview', { profileId, url });
			renderPreviewResult(resultContainer, profileId, url, preview);
		} catch (e) {
			resultContainer.innerHTML = `<div class="card"><p style="color:var(--danger)">${escapeHtml(e.message)}</p></div>`;
		}
	}

	card.querySelector('#fetch-preview-btn').addEventListener('click', doPreview);
	if (prefillUrl) doPreview();
}

/**
 * Fristående "nytt inlägg"-sida (med profilväljare). Används när ingen profil redan är
 * vald i sammanhanget – t.ex. när man delar en länk från mobilens delningsmeny (PWA
 * share target), eller går direkt till #/new.
 */
async function renderNewPost(app, profileId, query) {
	const profiles = await api('GET', '/api/profiles');
	app.innerHTML = '';

	app.appendChild(el(`<a href="#/" class="muted" style="text-decoration:none;">← Alla profiler</a>`));
	app.appendChild(el(`<h1 class="section-title">Nytt inlägg</h1>`));

	if (profiles.length === 0) {
		app.appendChild(el('<div class="empty-state">Du behöver skapa en profil först.</div>'));
		return;
	}

	const card = el(`
		<div class="card">
			<div class="field">
				<label>Profil</label>
				<select id="profile-select">
					${profiles.map((p) => `<option value="${p.id}" ${p.id === profileId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
				</select>
			</div>
			<div class="field">
				<label>Länk att dela</label>
				<input type="url" id="post-url" placeholder="https://din-sajt.se/en-artikel" value="${escapeHtml(query.url || '')}" />
			</div>
			<button class="btn btn-primary" id="fetch-preview-btn">Hämta förhandsgranskning</button>
		</div>
	`);
	app.appendChild(card);

	const resultContainer = el('<div id="new-post-result"></div>');
	app.appendChild(resultContainer);

	async function doPreview() {
		const pid = card.querySelector('#profile-select').value;
		const url = card.querySelector('#post-url').value.trim();
		if (!url) return;
		resultContainer.innerHTML = '<p><span class="spinner"></span> Hämtar sidan och genererar förhandsgranskning…</p>';
		try {
			const preview = await api('POST', '/api/preview', { profileId: pid, url });
			renderPreviewResult(resultContainer, pid, url, preview);
		} catch (e) {
			resultContainer.innerHTML = `<div class="card"><p style="color:var(--danger)">${escapeHtml(e.message)}</p></div>`;
		}
	}

	card.querySelector('#fetch-preview-btn').addEventListener('click', doPreview);
	if (query.url) doPreview();
}

function renderPreviewResult(container, profileId, url, preview) {
	container.innerHTML = '';

	const platformKeys = [...new Set([
		...(preview.facebookEnabled ? ['facebook'] : []),
		...Object.keys(preview.textVariants || {}),
	])];

	const initials = (key) => (PLATFORM_LABELS[key] || key).slice(0, 2).toUpperCase();

	const wrap = el(`
		<div>
			<div class="composer-grid">
				<div class="card">
					<p class="field-label">Publicera till</p>
					<div class="platform-toggle-row">
						${platformKeys.map((key) => `<button type="button" class="platform-toggle selected" data-platform="${key}" title="${escapeHtml(PLATFORM_LABELS[key] || key)}">${initials(key)}</button>`).join('')}
					</div>

					<div class="field">
						<label>Rubrik (Facebook-inlägget, kommentaren och alla textplattformar)</label>
						<input type="text" id="edit-title" value="${escapeHtml(preview.title)}" />
					</div>
					<div class="field">
						<label>Lockande rubrik för bilden (AI-genererad${preview.intensity ? ', intensitet ' + preview.intensity + '/10' : ''})</label>
						<input type="text" id="edit-image-headline" value="${escapeHtml(preview.imageHeadline)}" />
					</div>
					<div class="field">
						<label>Schemalägg till (lämna tomt för att publicera direkt)</label>
						<input type="datetime-local" id="schedule-at" />
					</div>
					<div style="display:flex; gap:8px; margin-top:8px; border-top:0.5px solid var(--border); padding-top:14px;">
						<button class="btn btn-secondary" id="schedule-btn" style="flex:1;">Schemalägg</button>
						<button class="btn btn-primary" id="publish-btn" style="flex:1;">Publicera nu</button>
					</div>
					<div id="publish-result" style="margin-top:12px;"></div>
				</div>

				<div>
					<p class="field-label">Förhandsgranskning</p>
					<div id="preview-cards"></div>
				</div>
			</div>
		</div>
	`);
	container.appendChild(wrap);

	// -------- Förhandsgranskningskort per plattform --------
	const cardsContainer = wrap.querySelector('#preview-cards');
	for (const key of platformKeys) {
		let bodyHtml;
		if (key === 'facebook') {
			const imgHtml = preview.imageBase64
				? `<img src="${preview.imageBase64}" style="width:100%;border-radius:8px;margin-bottom:8px;display:block;" />`
				: `<div class="muted" style="font-size:12px;padding:20px 0;text-align:center;">${preview.imageError ? escapeHtml(preview.imageError) : 'Ingen bild hittades på sidan.'}</div>`;
			bodyHtml = `${imgHtml}<p class="preview-card-text" data-role="fb-caption">${escapeHtml(preview.title)}. Länk i kommentarerna ⬇️</p>`;
		} else {
			const variant = preview.textVariants[key];
			bodyHtml = `
				<p class="preview-card-text">${escapeHtml(variant.text)}</p>
				<div class="preview-card-meta"><span class="char-count ${variant.charCount > variant.charLimit ? 'over' : ''}">${variant.charCount}/${variant.charLimit} tecken</span></div>
			`;
		}
		const card = el(`
			<div class="preview-card" data-platform-card="${key}">
				<div class="preview-card-head">
					<span class="preview-card-avatar">${initials(key)}</span>
					<span class="muted" style="font-size:12px;">${escapeHtml(PLATFORM_LABELS[key] || key)}</span>
				</div>
				${bodyHtml}
			</div>
		`);
		cardsContainer.appendChild(card);
	}

	// -------- Rubrikfälten uppdaterar förhandsgranskningskorten live --------
	function syncFacebookPreviewText() {
		const el2 = wrap.querySelector('[data-role="fb-caption"]');
		if (el2) el2.innerHTML = `${escapeHtml(wrap.querySelector('#edit-title').value)}. Länk i kommentarerna ⬇️`;
	}
	wrap.querySelector('#edit-title').addEventListener('input', syncFacebookPreviewText);

	// -------- Plattformsväljare (cirklar) styr både urval och vilka kort som visas --------
	wrap.querySelectorAll('.platform-toggle').forEach((btn) => {
		btn.addEventListener('click', () => {
			const key = btn.dataset.platform;
			const willSelect = !btn.classList.contains('selected');
			btn.classList.toggle('selected', willSelect);
			const card = cardsContainer.querySelector(`[data-platform-card="${key}"]`);
			if (card) card.style.opacity = willSelect ? '1' : '0.35';
		});
	});

	async function doPublish(scheduled) {
		const selectedPlatforms = [...wrap.querySelectorAll('.platform-toggle.selected')].map((b) => b.dataset.platform);
		if (selectedPlatforms.length === 0) {
			alert('Välj minst en plattform.');
			return;
		}
		const scheduleVal = wrap.querySelector('#schedule-at').value;
		const body = {
			profileId,
			url,
			title: wrap.querySelector('#edit-title').value,
			imageHeadline: wrap.querySelector('#edit-image-headline').value,
			metaImage: preview.metaImage,
			platforms: selectedPlatforms,
			scheduledAt: scheduled && scheduleVal ? new Date(scheduleVal).toISOString() : null,
		};
		const resultDiv = wrap.querySelector('#publish-result');
		resultDiv.innerHTML = '<span class="spinner"></span> Publicerar…';
		try {
			const res = await api('POST', '/api/publish', body);
			if (res.scheduled) {
				resultDiv.innerHTML = `<p style="color:var(--success)">✅ Schemalagt till ${new Date(body.scheduledAt).toLocaleString('sv-SE')}.</p>`;
			} else {
				const lines = Object.entries(res.post.results || {}).map(([k, r]) =>
					`<div>${r.ok ? '✅' : '❌'} ${PLATFORM_LABELS[k] || k}${r.ok ? '' : ': ' + escapeHtml(r.error)}${r.warning ? ' (varning: ' + escapeHtml(r.warning) + ')' : ''}</div>`
				);
				resultDiv.innerHTML = lines.join('');
			}
		} catch (e) {
			resultDiv.innerHTML = `<p style="color:var(--danger)">${escapeHtml(e.message)}</p>`;
		}
	}

	wrap.querySelector('#publish-btn').addEventListener('click', () => doPublish(false));
	wrap.querySelector('#schedule-btn').addEventListener('click', () => doPublish(true));
}

// ====================== Historik ======================

async function renderHistory(app, profileId) {
	app.innerHTML = '';
	app.appendChild(el(`<h1 class="section-title">Historik</h1>`));
	await renderPostList(app, profileId, { showProfileName: true, showCommentersLink: false });
}

/**
 * Delad rendering av en inläggslista (används både av den globala historiken och av
 * "Historik"-fliken inbäddad på en profilsida). Visar status, statistik (om hämtad) och
 * en möjlighet att läsa Facebook-kommentarer per inlägg.
 */
async function renderPostList(container, profileId, opts = {}) {
	const [posts, profiles] = await Promise.all([
		api('GET', profileId ? `/api/posts?profileId=${profileId}` : '/api/posts'),
		api('GET', '/api/profiles'),
	]);
	const profileName = (id) => profiles.find((p) => p.id === id)?.name || '(okänd profil)';

	if (opts.showCommentersLink && profileId) {
		container.appendChild(el(`
			<div style="display:flex;gap:16px;margin-bottom:14px;">
				<a href="#/profile/${profileId}/comments" class="muted">💬 Bevaka kommentarer →</a>
				<a href="#/profile/${profileId}/commenters" class="muted">👥 Se vilka som kommenterat mest →</a>
			</div>
		`));
	}

	if (posts.length === 0) {
		container.appendChild(el('<div class="empty-state">Inga inlägg ännu.</div>'));
		return;
	}

	for (const post of posts) {
		const platformResults = post.results
			? Object.entries(post.results).map(([k, r]) => `<span class="badge ${r.ok ? 'badge-done' : 'badge-error'}">${r.ok ? '✅' : '❌'} ${PLATFORM_LABELS[k] || k}</span>`).join(' ')
			: (post.platforms || []).map((k) => `<span class="badge badge-scheduled">${PLATFORM_LABELS[k] || k}</span>`).join(' ');

		const hasResults = post.results && Object.values(post.results).some((r) => r.ok);

		const item = el(`
			<div class="post-item">
				<div class="title">${escapeHtml(post.title)}</div>
				<div class="meta">${opts.showProfileName ? escapeHtml(profileName(post.profileId)) + ' · ' : ''}<a href="${escapeHtml(post.url)}" target="_blank" rel="noopener">${escapeHtml(post.url)}</a></div>
				<div class="meta">Skapad: ${new Date(post.createdAt).toLocaleString('sv-SE')} ${post.scheduledAt ? '· Schemalagd: ' + new Date(post.scheduledAt).toLocaleString('sv-SE') : ''}</div>
				<div style="margin-top:8px;"><span class="badge badge-${post.status}">${post.status}</span> ${platformResults}</div>
				<div class="stats-row" style="margin-top:8px;"></div>
				${post.status === 'scheduled' ? '<div style="margin-top:8px;display:flex;gap:8px;"><button class="btn btn-primary btn-sm publish-now-btn">Publicera nu</button><button class="btn btn-danger btn-sm cancel-btn">Avbryt</button></div>' : ''}
				<div style="margin-top:8px;display:flex;gap:8px;">
					${hasResults ? '<button class="btn btn-secondary btn-sm stats-btn">🔄 Uppdatera statistik</button>' : ''}
					${post.status !== 'scheduled' ? '<button class="btn btn-danger btn-sm delete-btn">🗑 Ta bort</button>' : ''}
				</div>
			</div>
		`);

		renderStatsRow(item.querySelector('.stats-row'), post.stats);

		item.querySelector('.cancel-btn')?.addEventListener('click', async () => {
			await api('DELETE', `/api/posts/${post.id}`);
			render();
		});

		item.querySelector('.delete-btn')?.addEventListener('click', async () => {
			if (!confirm('Ta bort det här inlägget ur historiken permanent? (Själva Facebook-inlägget påverkas inte – det här tar bara bort raden här i appen.)')) return;
			await api('DELETE', `/api/posts/${post.id}`);
			render();
		});

		item.querySelector('.publish-now-btn')?.addEventListener('click', async (e) => {
			const btn = e.target;
			if (!confirm('Publicera det här inlägget direkt, istället för att vänta på den schemalagda tiden?')) return;
			btn.disabled = true;
			btn.textContent = 'Publicerar…';
			try {
				await api('POST', `/api/posts/${post.id}/publish-now`);
				render();
			} catch (err) {
				alert('Kunde inte publicera: ' + err.message);
				btn.disabled = false;
				btn.textContent = 'Publicera nu';
			}
		});

		item.querySelector('.stats-btn')?.addEventListener('click', async (e) => {
			const btn = e.target;
			btn.disabled = true;
			btn.textContent = 'Hämtar…';
			try {
				const res = await api('POST', `/api/posts/${post.id}/refresh-stats`);
				post.stats = res.stats;
				renderStatsRow(item.querySelector('.stats-row'), post.stats);
				const errorKeys = Object.keys(res.errors || {});
				if (errorKeys.length) {
					const msg = errorKeys.map((k) => `${PLATFORM_LABELS[k] || k}: ${res.errors[k]}`).join(' · ');
					item.querySelector('.stats-row').appendChild(el(`<div class="muted" style="font-size:11px;color:var(--danger);margin-top:4px;">${escapeHtml(msg)}</div>`));
				}
			} catch (err) {
				alert('Kunde inte hämta statistik: ' + err.message);
			} finally {
				btn.disabled = false;
				btn.textContent = '🔄 Uppdatera statistik';
			}
		});

		container.appendChild(item);
	}
}

function renderStatsRow(container, stats) {
	if (!container) return;
	container.innerHTML = '';
	if (!stats || Object.keys(stats).length === 0) return;

	for (const [platform, s] of Object.entries(stats)) {
		const parts = [];
		if (s.likes !== null && s.likes !== undefined) parts.push(`👍 ${s.likes}`);
		if (s.comments !== null && s.comments !== undefined) parts.push(`💬 ${s.comments}`);
		if (s.shares !== null && s.shares !== undefined) parts.push(`🔁 ${s.shares}`);
		container.appendChild(el(`<span class="badge" style="background:#eef1f5;color:var(--text);margin-right:6px;">${PLATFORM_LABELS[platform] || platform}: ${parts.join('  ')}</span>`));
	}
}

// ====================== Kommentatörer (Facebook-"minne") ======================

/**
 * Tvådelad kommentarsbevakning: lista över Facebook-inlägg till vänster, kommentarstråd
 * för det valda inlägget till höger. Kommentarer hämtas från Facebook (och sparas lokalt
 * för "minnet") när ett inlägg väljs.
 */
async function renderCommentsHub(app, profileId, preselectPostId) {
	const [allPosts, profile, commenters] = await Promise.all([
		api('GET', `/api/posts?profileId=${profileId}`),
		api('GET', `/api/profiles/${profileId}`),
		api('GET', `/api/profiles/${profileId}/commenters`),
	]);
	const fbPosts = allPosts.filter((p) => p.results?.facebook?.ok);
	const countByFromId = new Map(commenters.map((c) => [c.fromId, c.count]));

	app.innerHTML = '';
	app.appendChild(el(`<a href="#/profile/${profileId}" class="muted" style="text-decoration:none;">← ${escapeHtml(profile.name)}</a>`));
	app.appendChild(el(`<h1 class="section-title">Bevaka kommentarer</h1>`));

	if (fbPosts.length === 0) {
		app.appendChild(el('<div class="empty-state">Inga Facebook-inlägg att visa kommentarer för ännu.</div>'));
		return;
	}

	const hub = el(`
		<div class="comments-hub">
			<div class="comments-hub-list"></div>
			<div class="comments-hub-thread"><p class="muted" style="padding:14px;font-size:13px;">Välj ett inlägg till vänster.</p></div>
		</div>
	`);
	app.appendChild(hub);
	const listEl = hub.querySelector('.comments-hub-list');
	const threadEl = hub.querySelector('.comments-hub-thread');

	function selectPost(post, listItemEl) {
		listEl.querySelectorAll('.comments-hub-list-item').forEach((n) => n.classList.remove('active'));
		listItemEl.classList.add('active');
		loadThread(post);
	}

	async function loadThread(post) {
		threadEl.innerHTML = '<p class="muted" style="padding:14px;font-size:13px;"><span class="spinner"></span> Hämtar kommentarer…</p>';
		try {
			const res = await api('POST', `/api/posts/${post.id}/fetch-comments`);
			renderThread(post, res.comments);
		} catch (e) {
			threadEl.innerHTML = `<p style="padding:14px;font-size:13px;color:var(--danger);">${escapeHtml(e.message)}</p>`;
		}
	}

	function renderThread(post, comments) {
		threadEl.innerHTML = '';
		threadEl.appendChild(el(`
			<div class="comments-hub-thread-head">
				<p style="font-weight:600;font-size:14px;margin:0;">${escapeHtml(post.title)}</p>
				<p class="muted" style="font-size:12px;margin:2px 0 0;">Publicerat på Facebook · ${comments.length} kommentar${comments.length === 1 ? '' : 'er'}</p>
			</div>
		`));
		if (comments.length === 0) {
			threadEl.appendChild(el('<p class="muted" style="padding:14px;font-size:13px;">Inga kommentarer ännu.</p>'));
			return;
		}
		for (const c of comments) {
			const totalCount = countByFromId.get(c.fromId) || 1;
			const historyLine = !c.fromId
				? ''
				: totalCount <= 1
					? '<p class="comment-history-link muted">Ny kommentator, ingen tidigare historik</p>'
					: `<a href="#/profile/${profileId}/commenters/${encodeURIComponent(c.fromId)}" class="comment-history-link">Visa alla kommentarer från ${escapeHtml(c.fromName)} (${totalCount}) →</a>`;
			threadEl.appendChild(el(`
				<div class="comments-hub-comment">
					<span class="preview-card-avatar" style="width:28px;height:28px;font-size:11px;">${escapeHtml((c.fromName || '?').slice(0, 2).toUpperCase())}</span>
					<div style="flex:1;min-width:0;">
						<p style="margin:0;font-size:13px;"><span style="font-weight:600;">${escapeHtml(c.fromName)}</span> <span class="muted" style="font-size:11px;">${new Date(c.createdTime).toLocaleString('sv-SE')}</span></p>
						<p style="margin:4px 0 0;font-size:13px;color:var(--muted);">${escapeHtml(c.message)}</p>
						${historyLine}
					</div>
				</div>
			`));
		}
	}

	let firstItemEl = null;
	let preselected = null;
	for (const post of fbPosts) {
		const count = post.stats?.facebook?.comments;
		const item = el(`
			<div class="comments-hub-list-item">
				<button type="button" class="comments-hub-delete-btn" title="Ta bort ur historiken">✕</button>
				<p style="margin:0;font-size:13px;font-weight:600;padding-right:18px;">${escapeHtml(post.title)}</p>
				<p class="muted" style="margin:4px 0 0;font-size:12px;">${count !== undefined ? count + ' kommentar' + (count === 1 ? '' : 'er') : 'Klicka för att hämta'}</p>
			</div>
		`);
		item.addEventListener('click', () => selectPost(post, item));
		item.querySelector('.comments-hub-delete-btn').addEventListener('click', async (e) => {
			e.stopPropagation();
			if (!confirm('Ta bort det här inlägget ur historiken permanent? (Själva Facebook-inlägget påverkas inte.)')) return;
			await api('DELETE', `/api/posts/${post.id}`);
			renderCommentsHub(app, profileId, null);
		});
		listEl.appendChild(item);
		if (!firstItemEl) firstItemEl = item;
		if (preselectPostId && post.id === preselectPostId) preselected = { post, item };
	}

	const initial = preselected || { post: fbPosts[0], item: firstItemEl };
	selectPost(initial.post, initial.item);
}

async function renderCommentersOverview(app, profileId) {
	const [commenters, profile] = await Promise.all([
		api('GET', `/api/profiles/${profileId}/commenters`),
		api('GET', `/api/profiles/${profileId}`),
	]);

	app.innerHTML = '';
	app.appendChild(el(`<a href="#/profile/${profileId}" class="muted" style="text-decoration:none;">← ${escapeHtml(profile.name)}</a>`));
	app.appendChild(el(`<h1 class="section-title">Kommentatorer</h1>`));
	app.appendChild(el('<p class="muted">Bygger på de kommentarer du hämtat via "Visa kommentarer" på enskilda inlägg. Klicka "Visa kommentarer" på fler inlägg i historiken för att fylla på listan.</p>'));

	if (commenters.length === 0) {
		app.appendChild(el('<div class="empty-state">Inga kommentarer hämtade ännu. Gå till Historik och klicka "Visa kommentarer" på ett inlägg för att börja bygga upp listan.</div>'));
		return;
	}

	const list = el('<div class="card"></div>');
	for (const c of commenters) {
		list.appendChild(el(`
			<a href="#/profile/${profileId}/commenters/${encodeURIComponent(c.fromId)}" class="profile-list-item">
				<div>
					<div class="name">${escapeHtml(c.fromName)}</div>
					<div class="meta">${c.count} kommentar${c.count === 1 ? '' : 'er'} · senast ${new Date(c.lastCommentAt).toLocaleDateString('sv-SE')}</div>
				</div>
				<span>›</span>
			</a>
		`));
	}
	app.appendChild(list);
}

async function renderCommenterDetail(app, profileId, fromId) {
	const [comments, profile] = await Promise.all([
		api('GET', `/api/profiles/${profileId}/commenters/${encodeURIComponent(fromId)}`),
		api('GET', `/api/profiles/${profileId}`),
	]);

	app.innerHTML = '';
	app.appendChild(el(`<a href="#/profile/${profileId}/commenters" class="muted" style="text-decoration:none;">← Alla kommentatorer</a>`));
	app.appendChild(el(`<h1 class="section-title">${escapeHtml(comments[0]?.fromName || 'Okänd')}</h1>`));
	app.appendChild(el(`<p class="muted">${comments.length} kommentar${comments.length === 1 ? '' : 'er'} på ${escapeHtml(profile.name)}s inlägg</p>`));

	for (const c of comments) {
		app.appendChild(el(`
			<div class="post-item">
				<div class="meta">${new Date(c.createdTime).toLocaleString('sv-SE')} · på: ${c.postUrl ? `<a href="${escapeHtml(c.postUrl)}" target="_blank" rel="noopener">${escapeHtml(c.postTitle)}</a>` : escapeHtml(c.postTitle)}</div>
				<div style="margin-top:4px;">${escapeHtml(c.message)}</div>
			</div>
		`));
	}
}

