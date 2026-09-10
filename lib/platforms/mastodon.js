const fetch = require('node-fetch');

const CHAR_LIMIT = 500; // Standard på de flesta instanser, kan vara högre på vissa.

const { buildPostText } = require('../textFormat');

/**
 * @param {object} creds { instanceUrl, accessToken }
 */
async function postText(creds, headline, url) {
	const base = creds.instanceUrl.replace(/\/+$/, '');
	const response = await fetch(`${base}/api/v1/statuses`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${creds.accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ status: buildPostText(headline, url) }),
		timeout: 20000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Mastodon svarade med fel: ${body?.error || JSON.stringify(body)}`);
	}
	return { id: body.id, url: body.url };
}

async function testConnection(creds) {
	const base = creds.instanceUrl.replace(/\/+$/, '');
	const response = await fetch(`${base}/api/v1/accounts/verify_credentials`, {
		headers: { Authorization: `Bearer ${creds.accessToken}` },
		timeout: 15000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Mastodon svarade med fel: ${body?.error || JSON.stringify(body)}`);
	}
	return `Ansluten som @${body.username}@${new URL(base).hostname}`;
}

/**
 * Hämtar gilla-markeringar, svar och delningar (boost/reblog) för ett inlägg.
 */
async function getStats(creds, statusId) {
	const base = creds.instanceUrl.replace(/\/+$/, '');
	const response = await fetch(`${base}/api/v1/statuses/${statusId}`, {
		headers: { Authorization: `Bearer ${creds.accessToken}` },
		timeout: 15000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Mastodon svarade med fel: ${body?.error || JSON.stringify(body)}`);
	}
	return { likes: body.favourites_count ?? 0, comments: body.replies_count ?? 0, shares: body.reblogs_count ?? 0 };
}

module.exports = { postText, testConnection, buildPostText, getStats, CHAR_LIMIT };
