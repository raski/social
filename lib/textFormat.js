/**
 * Ser till att en text slutar med ett skiljetecken (punkt om inget annat redan finns).
 */
function ensureSentence(text) {
	const trimmed = (text || '').trim();
	if (!trimmed) return trimmed;
	return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Bygger texten som skickas till textbaserade plattformar (X, Mastodon, Bluesky,
 * Threads, LinkedIn): rubrik + länk på SAMMA rad, med en punkt efter rubriken
 * om den inte redan slutar med ett skiljetecken.
 *
 * Exempel: "Elbilsboom i Danmark – över 700 000 elbilar" + url
 *       -> "Elbilsboom i Danmark – över 700 000 elbilar. https://..."
 */
function buildPostText(headline, url) {
	const trimmed = ensureSentence(headline);
	if (!trimmed) return url;
	return `${trimmed} ${url}`;
}

module.exports = { buildPostText, ensureSentence };
