/**
 * Bygger texten som skickas till textbaserade plattformar (X, Mastodon, Bluesky,
 * Threads, LinkedIn): rubrik + länk på SAMMA rad, med en punkt efter rubriken
 * om den inte redan slutar med ett skiljetecken.
 *
 * Exempel: "Elbilsboom i Danmark – över 700 000 elbilar" + url
 *       -> "Elbilsboom i Danmark – över 700 000 elbilar. https://..."
 */
function buildPostText(headline, url) {
	const trimmed = (headline || '').trim();
	if (!trimmed) return url;
	const endsWithPunctuation = /[.!?…]$/.test(trimmed);
	const separator = endsWithPunctuation ? ' ' : '. ';
	return `${trimmed}${separator}${url}`;
}

module.exports = { buildPostText };
