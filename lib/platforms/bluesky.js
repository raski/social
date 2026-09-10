const fetch = require('node-fetch');

const CHAR_LIMIT = 300;

const { buildPostText } = require('../textFormat');

/**
 * Skapar en session (inloggning) mot Bluesky. Görs på nytt vid varje postning eftersom
 * access-tokens bara gäller några minuter och vi postar sällan nog att det inte är värt
 * att hantera förnyelse-logik.
 *
 * @param {object} creds { handle, appPassword, service? }
 */
async function login(creds) {
	const service = (creds.service || 'https://bsky.social').replace(/\/+$/, '');
	const response = await fetch(`${service}/xrpc/com.atproto.server.createSession`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identifier: creds.handle, password: creds.appPassword }),
		timeout: 15000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Bluesky-inloggning misslyckades: ${body?.message || JSON.stringify(body)}`);
	}
	return { ...body, service };
}

/**
 * Bygger en "facet" (AT Protocol-term för rik text-markering) som gör länken klickbar.
 * Byte-offsets måste räknas i UTF-8-bytes, inte tecken – annars blir länken felplacerad
 * så fort texten innehåller å/ä/ö/emoji före länken.
 */
function buildLinkFacet(fullText, url) {
	const encoder = new TextEncoder();
	const byteStart = encoder.encode(fullText.slice(0, fullText.indexOf(url))).length;
	const byteEnd = byteStart + encoder.encode(url).length;
	return [
		{
			index: { byteStart, byteEnd },
			features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
		},
	];
}

async function postText(creds, headline, url) {
	const session = await login(creds);
	const text = buildPostText(headline, url);

	const response = await fetch(`${session.service}/xrpc/com.atproto.repo.createRecord`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${session.accessJwt}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			repo: session.did,
			collection: 'app.bsky.feed.post',
			record: {
				$type: 'app.bsky.feed.post',
				text,
				facets: buildLinkFacet(text, url),
				createdAt: new Date().toISOString(),
			},
		}),
		timeout: 20000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Bluesky svarade med fel: ${body?.message || JSON.stringify(body)}`);
	}
	return { id: body.uri, url: null };
}

async function testConnection(creds) {
	const session = await login(creds);
	return `Ansluten som ${session.handle}`;
}

/**
 * Hämtar gilla-markeringar, svar och reposter för ett Bluesky-inlägg (via dess at:// URI).
 */
async function getStats(creds, uri) {
	const session = await login(creds);
	const url = `${session.service}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${session.accessJwt}` },
		timeout: 15000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Bluesky svarade med fel: ${body?.message || JSON.stringify(body)}`);
	}
	const post = body.posts?.[0];
	if (!post) throw new Error('Inlägget hittades inte (kan ha raderats).');
	return { likes: post.likeCount ?? 0, comments: post.replyCount ?? 0, shares: post.repostCount ?? 0 };
}

module.exports = { postText, testConnection, buildPostText, getStats, CHAR_LIMIT };
