const fetch = require('node-fetch');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (compatible; SocialPosterBot/1.0; +https://example.com/bot)';

/**
 * Hämtar en webbsida och extraherar titel, artikelbild och en kort beskrivning,
 * i första hand via Open Graph-taggar (og:title, og:image, og:description),
 * med enkla fallbacks (<title>, <meta name="description">, första <img>).
 *
 * @param {string} url
 * @returns {Promise<{title: string, image: string|null, description: string, siteName: string, url: string}>}
 */
async function fetchMetadata(url) {
	const parsed = new URL(url); // Kastar fel om URL:en är ogiltig – fångas av anroparen.

	const response = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
		redirect: 'follow',
		timeout: 15000,
	});

	if (!response.ok) {
		throw new Error(`Sidan svarade med HTTP ${response.status}`);
	}

	const contentType = response.headers.get('content-type') || '';
	if (!contentType.includes('text/html')) {
		throw new Error(`Länken pekar inte på en HTML-sida (Content-Type: ${contentType})`);
	}

	const html = await response.text();
	const $ = cheerio.load(html);

	const metaContent = (name) =>
		$(`meta[property="${name}"]`).attr('content') ||
		$(`meta[name="${name}"]`).attr('content') ||
		'';

	let title = metaContent('og:title') || $('title').first().text() || '';
	title = title.trim();

	let image = metaContent('og:image') || metaContent('og:image:url') || metaContent('twitter:image') || '';
	if (!image) {
		// Fallback: första rimligt stora <img> på sidan.
		const firstImg = $('img').filter((i, el) => {
			const src = $(el).attr('src') || '';
			return src && !src.startsWith('data:');
		}).first().attr('src');
		if (firstImg) image = firstImg;
	}
	if (image && !/^https?:\/\//i.test(image)) {
		// Relativ bild-URL – gör den absolut.
		image = new URL(image, url).toString();
	}

	let description = metaContent('og:description') || metaContent('description') || '';
	description = description.trim();

	const siteName = metaContent('og:site_name') || parsed.hostname.replace(/^www\./, '');

	if (!title) {
		throw new Error('Kunde inte hitta någon rubrik (og:title eller <title>) på sidan.');
	}

	return {
		title,
		image: image || null,
		description,
		siteName,
		url,
	};
}

module.exports = { fetchMetadata };
