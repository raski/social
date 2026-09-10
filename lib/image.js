const { createCanvas, loadImage, registerFont } = require('canvas');
const fetch = require('node-fetch');

const registeredFonts = new Set();

/**
 * Registrerar ett TTF-typsnitt hos canvas (måste göras innan det används i ctx.font).
 * Canvas kräver ett unikt "family"-namn per fil – vi använder filsökvägen som nyckel
 * för att undvika att registrera samma fil flera gånger.
 */
function ensureFontRegistered(fontPath, family) {
	if (registeredFonts.has(fontPath)) return family;
	registerFont(fontPath, { family });
	registeredFonts.add(fontPath);
	return family;
}

/**
 * Radbryter text baserat på verklig textbredd, mätt med canvas' ctx.measureText.
 */
function wrapText(ctx, text, maxWidth) {
	const words = text.trim().split(/\s+/);
	const lines = [];
	let current = '';

	for (const word of words) {
		const test = current === '' ? word : `${current} ${word}`;
		const width = ctx.measureText(test).width;
		if (width > maxWidth && current !== '') {
			lines.push(current);
			current = word;
		} else {
			current = test;
		}
	}
	if (current !== '') lines.push(current);
	return lines;
}

function hexToRgba(hex, alpha) {
	let h = (hex || '#000000').replace('#', '');
	if (h.length === 3) h = h.split('').map((c) => c + c).join('');
	const r = parseInt(h.substring(0, 2), 16) || 0;
	const g = parseInt(h.substring(2, 4), 16) || 0;
	const b = parseInt(h.substring(4, 6), 16) || 0;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Skapar en ny bild med rubriken inritad ovanpå (halvgenomskinlig panel + centrerad, radbruten text).
 *
 * @param {Buffer} sourceBuffer  Originalbilden som en buffer (jpg/png/webp).
 * @param {string} headline      Texten som ska ritas.
 * @param {object} opts
 * @param {string} [opts.fontPath]         Sökväg till en .ttf-fil. Om utelämnad används canvas standardtypsnitt.
 * @param {number} [opts.fontSizePct=6]    Textstorlek i % av bildens bredd (startvärde, krymps vid behov).
 * @param {number} [opts.maxLines=4]       Max antal rader innan texten krymps ytterligare.
 * @param {string} [opts.fontColor='#ffffff']
 * @param {string} [opts.overlayColor='#000000']
 * @param {number} [opts.overlayOpacity=55]  0–100.
 * @param {'top'|'center'|'bottom'} [opts.position='bottom']
 * @returns {Promise<Buffer>} JPEG-buffer.
 */
async function createImageWithHeadline(sourceBuffer, headline, opts = {}) {
	const image = await loadImage(sourceBuffer);
	const width = image.width;
	const height = image.height;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.drawImage(image, 0, 0, width, height);

	const fontFamily = opts.fontPath ? ensureFontRegistered(opts.fontPath, 'HeadlineFont') : 'sans-serif';
	const sizePct = Math.max(2, Math.min(15, opts.fontSizePct ?? 6));
	const maxLines = Math.max(1, opts.maxLines ?? 4);
	const maxTextWidth = width * 0.88;

	let fontSize = Math.max(12, Math.round(width * (sizePct / 100)));
	let lines = [];

	while (fontSize > 10) {
		ctx.font = `bold ${fontSize}px "${fontFamily}"`;
		lines = wrapText(ctx, headline, maxTextWidth);
		if (lines.length <= maxLines) break;
		fontSize -= 2;
	}
	ctx.font = `bold ${fontSize}px "${fontFamily}"`;
	const lineHeight = Math.round(fontSize * 1.35);

	const padding = Math.round(height * 0.03);
	const blockHeight = lines.length * lineHeight + padding * 2;

	const position = opts.position || 'bottom';
	let blockY;
	if (position === 'top') blockY = 0;
	else if (position === 'center') blockY = Math.round((height - blockHeight) / 2);
	else blockY = height - blockHeight;
	blockY = Math.max(0, blockY);

	const opacityPct = Math.max(0, Math.min(100, opts.overlayOpacity ?? 55));
	ctx.fillStyle = hexToRgba(opts.overlayColor || '#000000', opacityPct / 100);
	ctx.fillRect(0, blockY, width, blockHeight);

	ctx.fillStyle = opts.fontColor || '#ffffff';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';

	let y = blockY + padding + lineHeight * 0.8;
	for (const line of lines) {
		ctx.fillText(line, width / 2, y);
		y += lineHeight;
	}

	return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

/**
 * Genererar en enkel gradient-platshållarbild att förhandsgranska mot när ingen riktig bild finns.
 */
function generatePlaceholderImage(width = 1200, height = 675) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createLinearGradient(0, 0, 0, height);
	gradient.addColorStop(0, '#37475a');
	gradient.addColorStop(1, '#8f9aa8');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

/**
 * Hämtar en bild via URL och returnerar den som en Buffer.
 */
async function downloadImage(url) {
	const response = await fetch(url, { timeout: 30000 });
	if (!response.ok) {
		throw new Error(`Kunde inte hämta bilden (HTTP ${response.status}): ${url}`);
	}
	return Buffer.from(await response.arrayBuffer());
}

module.exports = { createImageWithHeadline, generatePlaceholderImage, downloadImage, ensureFontRegistered };
