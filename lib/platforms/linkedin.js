const fetch = require('node-fetch');

const CHAR_LIMIT = 3000;
const AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const SCOPES = 'openid profile w_member_social';

function buildPostText(headline, url) {
	return `${headline}\n\n${url}`;
}

/**
 * Bygger URL:en användaren ska skickas till för att godkänna åtkomst (steg 1 av OAuth2-flödet).
 *
 * @param {object} appCreds { clientId, redirectUri }
 * @param {string} state  Slumpad sträng för CSRF-skydd, sparas tillfälligt och verifieras vid callback.
 */
function buildAuthorizationUrl(appCreds, state) {
	const url = new URL(AUTH_URL);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', appCreds.clientId);
	url.searchParams.set('redirect_uri', appCreds.redirectUri);
	url.searchParams.set('scope', SCOPES);
	url.searchParams.set('state', state);
	return url.toString();
}

/**
 * Steg 2: byter en authorization code mot en access token (efter att användaren godkänt).
 */
async function exchangeCodeForToken(appCreds, code) {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: appCreds.redirectUri,
			client_id: appCreds.clientId,
			client_secret: appCreds.clientSecret,
		}),
		timeout: 20000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`LinkedIn svarade med fel vid tokenbyte: ${body?.error_description || JSON.stringify(body)}`);
	}
	// body innehåller: access_token, expires_in (sekunder, oftast 60 dagar).
	return body;
}

/**
 * Hämtar den inloggade personens LinkedIn-ID (behövs för att bygga "author"-URN:et vid postning).
 */
async function fetchPersonId(accessToken) {
	const response = await fetch('https://api.linkedin.com/v2/userinfo', {
		headers: { Authorization: `Bearer ${accessToken}` },
		timeout: 15000,
	});
	const body = await response.json();
	if (!response.ok) {
		throw new Error(`LinkedIn svarade med fel vid hämtning av profil-ID: ${JSON.stringify(body)}`);
	}
	return { id: body.sub, name: body.name };
}

/**
 * @param {object} creds { accessToken, personId }
 */
async function postText(creds, headline, url) {
	const response = await fetch('https://api.linkedin.com/rest/posts', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${creds.accessToken}`,
			'Content-Type': 'application/json',
			'X-Restli-Protocol-Version': '2.0.0',
			'LinkedIn-Version': '202401',
		},
		body: JSON.stringify({
			author: `urn:li:person:${creds.personId}`,
			commentary: buildPostText(headline, url),
			visibility: 'PUBLIC',
			distribution: {
				feedDistribution: 'MAIN_FEED',
				targetEntities: [],
				thirdPartyDistributionChannels: [],
			},
			lifecycleState: 'PUBLISHED',
			isReshareDisabledByAuthor: false,
		}),
		timeout: 20000,
	});

	if (!response.ok) {
		const errBody = await response.text();
		throw new Error(`LinkedIn svarade med fel: ${errBody}`);
	}
	const postId = response.headers.get('x-restli-id');
	return { id: postId, url: null };
}

async function testConnection(creds) {
	const { name } = await fetchPersonId(creds.accessToken);
	return `Ansluten som ${name}`;
}

module.exports = {
	postText,
	testConnection,
	buildPostText,
	buildAuthorizationUrl,
	exchangeCodeForToken,
	fetchPersonId,
	CHAR_LIMIT,
};
