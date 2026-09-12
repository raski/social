const fetch = require('node-fetch');
const FormData = require('form-data');
const { ensureSentence } = require('../textFormat');

const GRAPH_VERSION = 'v19.0';

function translateFbError(message) {
	if (/publish_actions/i.test(message)) {
		return `${message} — Beror troligen på att tokenet är ett User Token istället för ett Page Access Token, eller saknar pages_manage_posts.`;
	}
	if (/sufficient permissions/i.test(message)) {
		return `${message} — Kontrollera att pages_manage_engagement (för kommentarer) och pages_manage_posts (för inlägg) båda är beviljade.`;
	}
	if (/access token/i.test(message)) {
		return `${message} — Tokenet kan ha gått ut. Skapa ett nytt långlivat sidtoken.`;
	}
	return message;
}

/**
 * Laddar upp en bild med bildtext till sidans /photos-endpoint. Returnerar Facebook-inläggets ID.
 *
 * @param {object} creds { pageId, accessToken }
 * @param {Buffer} imageBuffer
 * @param {string} caption
 */
async function postPhoto(creds, imageBuffer, caption) {
	const form = new FormData();
	form.append('caption', caption);
	form.append('access_token', creds.accessToken);
	form.append('published', 'true');
	form.append('source', imageBuffer, { filename: 'post.jpg', contentType: 'image/jpeg' });

	const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.pageId}/photos`, {
		method: 'POST',
		body: form,
		timeout: 60000,
	});
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(`Facebook svarade med fel: ${translateFbError(body?.error?.message || JSON.stringify(body))}`);
	}
	return body.post_id || body.id;
}

async function postTextOnly(creds, message) {
	const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.pageId}/feed`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ message, access_token: creds.accessToken }),
		timeout: 30000,
	});
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(`Facebook svarade med fel: ${translateFbError(body?.error?.message || JSON.stringify(body))}`);
	}
	return body.id;
}

async function addComment(creds, fbPostId, message) {
	const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${fbPostId}/comments`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ message, access_token: creds.accessToken }),
		timeout: 30000,
	});
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(`Facebook svarade med fel vid kommentar: ${translateFbError(body?.error?.message || JSON.stringify(body))}`);
	}
	return body.id;
}

/**
 * Hela Facebook-flödet: bild med rubrik + originaltitel som text + kommentar med länk.
 *
 * @param {object} creds { pageId, accessToken }
 * @param {Buffer|null} imageBuffer  Färdig bild (med rubrik inritad), eller null om ingen bild finns.
 * @param {string} title       Inläggets riktiga rubrik (används i caption + kommentar).
 * @param {string} linkLine    T.ex. "Länk i kommentarerna ⬇️".
 * @param {string} commentPrefix T.ex. "🚦".
 * @param {string} url
 */
async function publishFullFlow(creds, imageBuffer, title, linkLine, commentPrefix, url) {
	const caption = `${ensureSentence(title)} ${linkLine}`;
	const fbPostId = imageBuffer
		? await postPhoto(creds, imageBuffer, caption)
		: await postTextOnly(creds, caption);

	const commentText = `${commentPrefix} ${ensureSentence(title)} ${url}`.trim();
	try {
		await addComment(creds, fbPostId, commentText);
	} catch (e) {
		// Inlägget gick igenom, men kommentaren misslyckades – returnera ändå framgång men flagga felet.
		return { id: fbPostId, commentError: e.message };
	}
	return { id: fbPostId, commentError: null };
}

async function testConnection(creds) {
	const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${creds.pageId}`);
	url.searchParams.set('fields', 'name,id');
	url.searchParams.set('access_token', creds.accessToken);
	const response = await fetch(url.toString(), { timeout: 15000 });
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(`Facebook svarade med fel: ${translateFbError(body?.error?.message || JSON.stringify(body))}`);
	}
	return `Ansluten till sidan "${body.name}"`;
}

/**
 * Hämtar reaktioner/kommentarer/delningar för ett publicerat Facebook-inlägg.
 */
async function getStats(creds, fbPostId) {
	const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${fbPostId}`);
	url.searchParams.set('fields', 'reactions.summary(true),comments.summary(true),shares');
	url.searchParams.set('access_token', creds.accessToken);
	const response = await fetch(url.toString(), { timeout: 15000 });
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(translateFbError(body?.error?.message || JSON.stringify(body)));
	}
	return {
		likes: body.reactions?.summary?.total_count ?? 0,
		comments: body.comments?.summary?.total_count ?? 0,
		shares: body.shares?.count ?? 0,
	};
}

/**
 * Hämtar kommentarerna på ett publicerat Facebook-inlägg (namn, text, tidpunkt, avsändarens FB-ID).
 */
async function getComments(creds, fbPostId) {
	const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${fbPostId}/comments`);
	url.searchParams.set('fields', 'id,message,created_time,from{id,name}');
	url.searchParams.set('limit', '100');
	url.searchParams.set('access_token', creds.accessToken);
	const response = await fetch(url.toString(), { timeout: 15000 });
	const body = await response.json();
	if (!response.ok || body.error) {
		throw new Error(translateFbError(body?.error?.message || JSON.stringify(body)));
	}
	return (body.data || []).map((c) => ({
		id: c.id,
		message: c.message || '',
		createdTime: c.created_time,
		fromId: c.from?.id || null,
		fromName: c.from?.name || 'Okänd användare',
		// Om Facebook inte skickade med avsändarinfo, spara hela rådatan så man kan se
		// exakt vad som faktiskt kom tillbaka (för felsökning/verifiering, inte gissningar).
		raw: c.from ? null : c,
	}));
}

module.exports = { publishFullFlow, testConnection, postPhoto, postTextOnly, addComment, getStats, getComments };
