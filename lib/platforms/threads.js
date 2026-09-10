const fetch = require('node-fetch');

const CHAR_LIMIT = 500;
const GRAPH_BASE = 'https://graph.threads.net/v1.0';

function buildPostText(headline, url) {
	return `${headline}\n\n${url}`;
}

/**
 * @param {object} creds { userId, accessToken }
 */
async function postText(creds, headline, url) {
	const text = buildPostText(headline, url);

	// Steg 1: skapa en container.
	const createUrl = new URL(`${GRAPH_BASE}/${creds.userId}/threads`);
	createUrl.searchParams.set('media_type', 'TEXT');
	createUrl.searchParams.set('text', text);
	createUrl.searchParams.set('access_token', creds.accessToken);

	const createResponse = await fetch(createUrl.toString(), { method: 'POST', timeout: 20000 });
	const createBody = await createResponse.json();
	if (!createResponse.ok || !createBody.id) {
		throw new Error(`Threads svarade med fel vid skapande av inlägg: ${createBody?.error?.message || JSON.stringify(createBody)}`);
	}

	// Steg 2: publicera containern (Meta rekommenderar en kort väntetid innan publicering).
	await new Promise((resolve) => setTimeout(resolve, 3000));

	const publishUrl = new URL(`${GRAPH_BASE}/${creds.userId}/threads_publish`);
	publishUrl.searchParams.set('creation_id', createBody.id);
	publishUrl.searchParams.set('access_token', creds.accessToken);

	const publishResponse = await fetch(publishUrl.toString(), { method: 'POST', timeout: 20000 });
	const publishBody = await publishResponse.json();
	if (!publishResponse.ok || !publishBody.id) {
		throw new Error(`Threads svarade med fel vid publicering: ${publishBody?.error?.message || JSON.stringify(publishBody)}`);
	}

	return { id: publishBody.id, url: null };
}

async function testConnection(creds) {
	const url = new URL(`${GRAPH_BASE}/${creds.userId}`);
	url.searchParams.set('fields', 'id,username');
	url.searchParams.set('access_token', creds.accessToken);
	const response = await fetch(url.toString(), { timeout: 15000 });
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`Threads svarade med fel: ${body?.error?.message || JSON.stringify(body)}`);
	}
	return `Ansluten som @${body.username}`;
}

module.exports = { postText, testConnection, buildPostText, CHAR_LIMIT };
