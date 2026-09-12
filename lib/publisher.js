const { createImageWithHeadline, downloadImage, generatePlaceholderImage } = require('./image');
const { generateHeadline, generateNeutralHeadline } = require('./ai');

const facebook = require('./platforms/facebook');
const x = require('./platforms/x');
const mastodon = require('./platforms/mastodon');
const bluesky = require('./platforms/bluesky');
const threads = require('./platforms/threads');
const linkedin = require('./platforms/linkedin');

const TEXT_ONLY_PLATFORMS = { x, mastodon, bluesky, threads, linkedin };

/**
 * Renderar Facebook-förhandsgranskningsbilden (artikelbild + inritad rubrik) för en profil.
 * Delad logik mellan förhandsgranskning, "byt rubrik"-omrendering och skarp publicering.
 *
 * @param {object} profile
 * @param {string} headline   Texten som ska ritas på bilden.
 * @param {string|null} metaImage  URL till artikelbilden, eller null/undefined för platshållare.
 * @returns {Promise<{imageBase64: string|null, imageError: string|null}>}
 */
async function renderFacebookPreviewImage(profile, headline, metaImage) {
	try {
		const imgSettings = profile.settings?.image || {};
		const sourceBuffer = metaImage ? await downloadImage(metaImage) : generatePlaceholderImage();
		const rendered = await createImageWithHeadline(sourceBuffer, headline, {
			fontPath: imgSettings.fontPath,
			fontSizePct: imgSettings.fontSizePct,
			maxLines: imgSettings.maxLines,
			fontColor: imgSettings.fontColor,
			overlayColor: imgSettings.overlayColor,
			overlayOpacity: imgSettings.overlayOpacity,
			position: imgSettings.position,
			layout: imgSettings.layout,
		});
		return { imageBase64: `data:image/jpeg;base64,${rendered.toString('base64')}`, imageError: null };
	} catch (e) {
		return { imageBase64: null, imageError: e.message };
	}
}

/**
 * Bygger en komplett förhandsgranskning för ett profil + URL, utan att posta något.
 * OBS: genererar INTE någon AI-rubrik automatiskt längre – bilden förhandsgranskas med
 * inläggets riktiga rubrik som standard. AI-rubriker väljs och genereras separat, ett
 * uttryckligt steg i själva förhandsgranskningen (se ajax_generate_headline-routen).
 *
 * @param {object} profile  Profilobjekt från databasen (innehåller .connections och .settings).
 * @param {object} meta     Resultat från fetchMetadata(url).
 * @returns {Promise<object>}
 */
async function buildPreview(profile, meta) {
	const { imageBase64, imageError } = await renderFacebookPreviewImage(profile, meta.title, meta.image);

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
		imageHeadline: meta.title,
		intensity: null,
		techniques: [],
		imageBase64,
		imageError,
		textVariants,
		facebookEnabled: !!profile.connections?.facebook?.enabled,
	};
}

/**
 * Genererar en ny rubrik (neutral eller "engagerande"/klickvänlig) för en given originalrubrik,
 * plus en färsk förhandsgranskningsbild med den nya rubriken inritad. Används av
 * "Neutral"/"Engagerande"/"Nytt förslag"-knapparna i komponeringsvyn.
 *
 * @param {object} profile
 * @param {string} title
 * @param {string} description
 * @param {string|null} metaImage
 * @param {'neutral'|'engaging'} level
 * @returns {Promise<{headline: string, intensity: number|null, techniques: string[], imageBase64: string|null, imageError: string|null}>}
 */
async function generateHeadlineWithPreview(profile, title, description, metaImage, level) {
	const aiSettings = profile.settings?.ai || {};
	const creds = { apiKey: aiSettings.apiKey, model: aiSettings.model };

	let aiResult;
	if (level === 'neutral') {
		aiResult = await generateNeutralHeadline(title, description, creds);
		aiResult = { ...aiResult, intensity: null, techniques: [] };
	} else {
		aiResult = await generateHeadline(title, description, { ...creds, level: 'high' });
	}

	const { imageBase64, imageError } = await renderFacebookPreviewImage(profile, aiResult.headline, metaImage);

	return { ...aiResult, imageBase64, imageError };
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
			const fbConn = profile.connections.facebook;
			const { imageBase64 } = await renderFacebookPreviewImage(profile, imageHeadline || title, postData.metaImage);
			let imageBuffer = null;
			if (imageBase64) {
				imageBuffer = Buffer.from(imageBase64.split(',', 2)[1], 'base64');
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

module.exports = { buildPreview, publishToSelectedPlatforms, generateHeadlineWithPreview, renderFacebookPreviewImage };
