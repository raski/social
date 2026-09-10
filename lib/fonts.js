const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const LEGACY_USER_AGENT = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)';
const VALID_SIGNATURES = [
	Buffer.from([0x00, 0x01, 0x00, 0x00]),
	Buffer.from('OTTO'),
	Buffer.from('true'),
	Buffer.from('typ1'),
];

function hasValidFontSignature(buf) {
	return VALID_SIGNATURES.some((sig) => buf.slice(0, sig.length).equals(sig));
}

/**
 * Försök 1: en direkt fil från Googles öppna typsnittsarkiv på GitHub (raw.githubusercontent.com).
 * Fungerar bara för klassiska statiska typsnitt (t.ex. "Archivo Black"), inte moderna variable fonts.
 */
async function tryGithubMirror(family) {
	const pascal = family.replace(/[^A-Za-z0-9]/g, '');
	const slug = pascal.toLowerCase();
	if (!pascal) return null;

	for (const license of ['ofl', 'apache', 'ufl']) {
		const url = `https://raw.githubusercontent.com/google/fonts/main/${license}/${slug}/${pascal}-Regular.ttf`;
		try {
			const response = await fetch(url, { timeout: 15000 });
			if (response.ok) {
				const buf = Buffer.from(await response.arrayBuffer());
				if (buf.length > 4096) return buf;
			}
		} catch (e) {
			// Prova nästa licensmapp.
		}
	}
	return null;
}

/**
 * Försök 2: Google Fonts CSS-API med en gammal user-agent för att tvinga fram en riktig .ttf
 * istället för .woff2.
 */
async function tryCssApi(family, weight) {
	const familySlug = family.replace(/[^A-Za-z0-9 ]/g, '').trim().replace(/\s+/g, '+');
	if (!familySlug) throw new Error('Typsnittsnamnet innehöll inga giltiga tecken.');

	const cssUrl = `https://fonts.googleapis.com/css2?family=${familySlug}:wght@${weight}&display=swap`;
	const cssResponse = await fetch(cssUrl, {
		headers: { 'User-Agent': LEGACY_USER_AGENT },
		timeout: 20000,
	});
	if (!cssResponse.ok) {
		throw new Error(`Hittade inget typsnitt med det namnet hos Google Fonts (HTTP ${cssResponse.status}).`);
	}
	const css = await cssResponse.text();
	const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/i);
	if (!match) {
		throw new Error('Kunde inte tolka svaret från Google Fonts.');
	}
	const fontResponse = await fetch(match[1], { timeout: 30000 });
	if (!fontResponse.ok) {
		throw new Error(`Kunde inte ladda ner typsnittsfilen (HTTP ${fontResponse.status}).`);
	}
	return Buffer.from(await fontResponse.arrayBuffer());
}

/**
 * Hämtar och sparar en .ttf-fil från Google Fonts lokalt på disk, med validering
 * (storlek, filsignatur) så en trasig/avbruten nedladdning inte smyger sig igenom.
 *
 * @param {string} family   T.ex. "Archivo Black".
 * @param {string} weight   T.ex. "700".
 * @param {string} destDir  Mapp att spara filen i.
 * @returns {Promise<{path: string, label: string}>}
 */
async function fetchGoogleFont(family, weight, destDir) {
	let binary = await tryGithubMirror(family);
	let source = 'Googles GitHub-arkiv';

	if (!binary) {
		binary = await tryCssApi(family, weight);
		source = 'Google Fonts';
	}

	if (!binary || binary.length < 4096) {
		throw new Error(`Den nedladdade typsnittsfilen var tom eller misstänkt liten (${binary ? binary.length : 0} bytes).`);
	}
	if (!hasValidFontSignature(binary)) {
		const hex = binary.slice(0, 16).toString('hex').toUpperCase();
		throw new Error(`Den nedladdade filen verkar inte vara en giltig typsnittsfil (fel filsignatur: ${hex}).`);
	}

	fs.mkdirSync(destDir, { recursive: true });
	const filename = `${family.replace(/[^A-Za-z0-9-]/g, '_')}-${weight}.ttf`;
	const filePath = path.join(destDir, filename);
	fs.writeFileSync(filePath, binary);

	return { path: filePath, label: `${family} ${weight} (hämtat från ${source})` };
}

module.exports = { fetchGoogleFont };
