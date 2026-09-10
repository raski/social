const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const fetch = require('node-fetch');

const CHAR_LIMIT = 280;

function makeOAuthClient(creds) {
	return OAuth({
		consumer: { key: creds.apiKey, secret: creds.apiSecret },
		signature_method: 'HMAC-SHA1',
		hash_function(baseString, key) {
			return crypto.createHmac('sha1', key).update(baseString).digest('base64');
		},
	});
}

/**
 * Bygger inläggstexten: rubrik + länk. X kortar länkar automatiskt till 23 tecken (t.co),
 * men vi räknar konservativt på den fulla länklängden för säkerhets skull i UI-varningar.
 */
const { buildPostText } = require('../textFormat');

/**
 * @param {object} creds { apiKey, apiSecret, accessToken, accessTokenSecret }
 * @param {string} headline
 * @param {string} url
 */
async function postText(creds, headline, url) {
	const oauthClient = makeOAuthClient(creds);
	const token = { key: creds.accessToken, secret: creds.accessTokenSecret };
	const requestData = { url: 'https://api.x.com/2/tweets', method: 'POST' };

	const authHeader = oauthClient.toHeader(oauthClient.authorize(requestData, token));

	const response = await fetch(requestData.url, {
		method: 'POST',
		headers: { ...authHeader, 'Content-Type': 'application/json' },
		body: JSON.stringify({ text: buildPostText(headline, url) }),
		timeout: 20000,
	});

	const body = await response.json();
	if (!response.ok) {
		throw new Error(`X svarade med fel: ${body?.detail || body?.title || JSON.stringify(body)}`);
	}
	return { id: body?.data?.id, url: `https://x.com/i/web/status/${body?.data?.id}` };
}

async function testConnection(creds) {
	const oauthClient = makeOAuthClient(creds);
	const token = { key: creds.accessToken, secret: creds.accessTokenSecret };
	const requestData = { url: 'https://api.x.com/2/users/me', method: 'GET' };
	const authHeader = oauthClient.toHeader(oauthClient.authorize(requestData, token));

	const response = await fetch(requestData.url, { headers: authHeader, timeout: 15000 });
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`X svarade med fel: ${body?.detail || body?.title || JSON.stringify(body)}`);
	}
	return `Ansluten som @${body?.data?.username}`;
}

/**
 * Hämtar publika engagemangssiffror (gilla-markeringar, svar, reposter) för en tweet.
 */
async function getStats(creds, tweetId) {
	const oauthClient = makeOAuthClient(creds);
	const token = { key: creds.accessToken, secret: creds.accessTokenSecret };
	const requestData = { url: `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics`, method: 'GET' };
	const authHeader = oauthClient.toHeader(oauthClient.authorize(requestData, token));

	const response = await fetch(requestData.url, { headers: authHeader, timeout: 15000 });
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`X svarade med fel: ${body?.detail || body?.title || JSON.stringify(body)}`);
	}
	const m = body?.data?.public_metrics || {};
	return { likes: m.like_count ?? 0, comments: m.reply_count ?? 0, shares: m.retweet_count ?? 0 };
}

module.exports = { postText, testConnection, buildPostText, getStats, CHAR_LIMIT };
