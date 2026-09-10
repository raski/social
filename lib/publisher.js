const { createImageWithHeadline, downloadImage } = require('./image');
const { generateHeadline } = require('./ai');

const facebook = require('./platforms/facebook');
const x = require('./platforms/x');
const mastodon = require('./platforms/mastodon');
const bluesky = require('./platforms/bluesky');
const threads = require('./platforms/threads');
const linkedin = require('./platforms/linkedin');

const TEXT_ONLY_PLATFORMS = { x, mastodon, bluesky, threads, linkedin };

/**
 * Bygger en komplett förhandsgranskning för ett profil + URL, utan att posta något.
 *
 * @param {object} profile  Profilobjekt från databasen (innehåller .connections och .settings).
 * @param {object} meta     Resultat från fetchMetadata(url).
 * @returns {Promise<object>} { title, url, description, imageHeadline, intensity, techniques, imagePreviewBase64, platforms: {...char counts m.m.} }
 */
async function buildPreview(profile, meta) {
	const aiSettings = profile.settings?.ai || {};
	const aiResult = await generateHeadline(meta.title, meta.description, {
		apiKey: aiSettings.apiKey,
		model: aiSettings.model,
		level: aiSettings.level || 'medium',
	});

	let imageBase64 = null;
	let imageError = null;
	try {
		const imgSettings = profile.settings?.image || {};
		const sourceBuffer = meta.image
			? await downloadImage(meta.image)
			: require('./image').generatePlaceholderImage();
		const rendered = await createImageWithHeadline(sourceBuffer, aiResult.headline, {
			fontPath: imgSettings.fontPath,
			fontSizePct: imgSettings.fontSizePct,
			maxLines: imgSettings.maxLines,
			fontColor: imgSettings.fontColor,
			overlayColor: imgSettings.overlayColor,
			overlayOpacity: imgSettings.overlayOpacity,
			position: imgSettings.position,
			layout: imgSettings.layout,
		});
		imageBase64 = `data:image/jpeg;base64,${rendered.toString('base64')}`;
	} catch (e) {
		imageError = e.message;
	}

	const textVariants = {};
	for (const [key, adapter] of Object.entries(TEXT_ONLY_PLATFORMS)) {
		if (profile.connections?.[key]?.enabled) {
			const text = adapter.buildPostText(meta.title, meta.url);
			textVariants[key] = { text, charCount: [...text].length, charLimit: adapter.CHAR_LIMIT };
		}
	}

	return {
		title: meta.title,
		description: meta.description,
		url: meta.url,
		imageHeadline: aiResult.headline,
		intensity: aiResult.intensity,
		techniques: aiResult.techniques,
		imageBase64,
		imageError,
		textVariants,
		facebookEnabled: !!profile.connections?.facebook?.enabled,
	};
}

/**
 * Publicerar (eller schemaläggningskör) ett inlägg till alla valda plattformar.
 * Varje plattform hanteras oberoende – ett fel på en plattform stoppar inte de andra.
 *
 * @param {object} profile
 * @param {object} postData  { url, title, imageHeadline, platforms: string[] }
 * @returns {Promise<object>} results per plattform: { [platform]: { ok: bool, id?, error? } }
 */
async function publishToSelectedPlatforms(profile, postData) {
	const results = {};
	const { url, title, imageHeadline, platforms } = postData;

	if (platforms.includes('facebook') && profile.connections?.facebook?.enabled) {
		try {
			const imgSettings = profile.settings?.image || {};
			const fbConn = profile.connections.facebook;
			let imageBuffer = null;
			try {
				const sourceBuffer = postData.metaImage
					? await downloadImage(postData.metaImage)
					: require('./image').generatePlaceholderImage();
				imageBuffer = await createImageWithHeadline(sourceBuffer, imageHeadline, {
					fontPath: imgSettings.fontPath,
					fontSizePct: imgSettings.fontSizePct,
					maxLines: imgSettings.maxLines,
					fontColor: imgSettings.fontColor,
					overlayColor: imgSettings.overlayColor,
					overlayOpacity: imgSettings.overlayOpacity,
					position: imgSettings.position,
					layout: imgSettings.layout,
				});
			} catch (imgErr) {
				imageBuffer = null; // Posta ändå, utan bild, hellre än att helt misslyckas.
			}

			const linkLine = profile.settings?.facebook?.linkLine || 'Länk i kommentarerna ⬇️';
			const commentPrefix = profile.settings?.facebook?.commentPrefix || '🚦';

			const result = await facebook.publishFullFlow(fbConn, imageBuffer, title, linkLine, commentPrefix, url);
			results.facebook = { ok: true, id: result.id, warning: result.commentError };
		} catch (e) {
			results.facebook = { ok: false, error: e.message };
		}
	}

	for (const [key, adapter] of Object.entries(TEXT_ONLY_PLATFORMS)) {
		if (platforms.includes(key) && profile.connections?.[key]?.enabled) {
			try {
				const result = await adapter.postText(profile.connections[key], title, url);
				results[key] = { ok: true, id: result.id };
			} catch (e) {
				results[key] = { ok: false, error: e.message };
			}
		}
	}

	return results;
}

module.exports = { buildPreview, publishToSelectedPlatforms };
