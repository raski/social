const { createCanvas, loadImage, registerFont } = require('canvas');
const fetch = require('node-fetch');

const registeredFonts = new Set();

// Standardformat för "stående"-läget (bredd:höjd) – 4:5, samma som Instagram/Facebook
// rekommenderar för stående inlägg.
const VERTICAL_ASPECT_RATIO = 4 / 5;

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
 * Hittar bästa textstorlek (krymper stegvis tills den får plats på max antal rader)
 * och returnerar de radbrutna raderna + vald fontstorlek.
 */
function fitText(ctx, text, fontFamily, startFontSize, maxWidth, maxLines) {
	let fontSize = startFontSize;
	let lines = [];
	while (fontSize > 10) {
		ctx.font = `bold ${fontSize}px "${fontFamily}"`;
		lines = wrapText(ctx, text, maxWidth);
		if (lines.length <= maxLines) break;
		fontSize -= 2;
	}
	ctx.font = `bold ${fontSize}px "${fontFamily}"`;
	return { lines, fontSize };
}

/**
 * Beskär en bild (via source-rektangel) så den fyller en given målproportion (cover-beskärning,
 * centrerad) – används av "vertical"-layouten.
 */
function coverCropRect(imgWidth, imgHeight, targetRatio) {
	const srcRatio = imgWidth / imgHeight;
	let sx, sy, sw, sh;
	if (srcRatio > targetRatio) {
		// Källan är proportionellt bredare än målet – beskär vänster/höger.
		sh = imgHeight;
		sw = sh * targetRatio;
		sx = (imgWidth - sw) / 2;
		sy = 0;
	} else {
		// Källan är proportionellt högre än målet – beskär topp/botten.
		sw = imgWidth;
		sh = sw / targetRatio;
		sx = 0;
		sy = (imgHeight - sh) / 2;
	}
	return { sx, sy, sw, sh };
}

/**
 * Skapar en ny bild med rubriken inritad, i en av tre layoutstilar.
 *
 * @param {Buffer} sourceBuffer  Originalbilden som en buffer (jpg/png/webp).
 * @param {string} headline      Texten som ska ritas.
 * @param {object} opts
 * @param {'overlay'|'below'|'vertical'} [opts.layout='overlay']
 *        - overlay: text ovanpå bilden (halvgenomskinlig panel), bildens proportioner oförändrade.
 *        - below: bilden orörd, texten på ett vitt fält UNDER bilden (svart text).
 *        - vertical: bilden beskärs till stående format (4:5), text ovanpå (som overlay).
 * @param {string} [opts.fontPath]         Sökväg till en .ttf-fil. Om utelämnad används canvas standardtypsnitt.
 * @param {number} [opts.fontSizePct=6]    Textstorlek i % av bildens bredd (startvärde, krymps vid behov).
 * @param {number} [opts.maxLines=4]       Max antal rader innan texten krymps ytterligare.
 * @param {string} [opts.fontColor='#ffffff']   Används av overlay/vertical (ignoreras av below, som alltid är svart).
 * @param {string} [opts.overlayColor='#000000'] Används av overlay/vertical.
 * @param {number} [opts.overlayOpacity=55]  0–100. Används av overlay/vertical.
 * @param {'top'|'center'|'bottom'} [opts.position='bottom']  Används av overlay/vertical.
 * @returns {Promise<Buffer>} JPEG-buffer.
 */
async function createImageWithHeadline(sourceBuffer, headline, opts = {}) {
	const layout = opts.layout || 'overlay';
	const image = await loadImage(sourceBuffer);
	const fontFamily = opts.fontPath ? ensureFontRegistered(opts.fontPath, 'HeadlineFont') : 'sans-serif';
	const sizePct = Math.max(2, Math.min(15, opts.fontSizePct ?? 6));
	const maxLines = Math.max(1, opts.maxLines ?? 4);

	if (layout === 'below') {
		return renderBelowLayout(image, headline, fontFamily, sizePct, maxLines);
	}
	if (layout === 'vertical') {
		return renderOverlayLayout(image, headline, fontFamily, sizePct, maxLines, opts, true);
	}
	return renderOverlayLayout(image, headline, fontFamily, sizePct, maxLines, opts, false);
}

/**
 * Layout 1 & 3: text i en halvgenomskinlig panel ovanpå bilden. Om `vertical` är true
 * beskärs bilden först till stående 4:5-format.
 */
function renderOverlayLayout(image, headline, fontFamily, sizePct, maxLines, opts, vertical) {
	let drawWidth = image.width;
	let drawHeight = image.height;
	let srcRect = null;

	if (vertical) {
		srcRect = coverCropRect(image.width, image.height, VERTICAL_ASPECT_RATIO);
		// Skala till en förnuftig utdatabredd (1080px) för rimlig filstorlek/kvalitet.
		drawWidth = 1080;
		drawHeight = Math.round(1080 / VERTICAL_ASPECT_RATIO);
	}

	const canvas = createCanvas(drawWidth, drawHeight);
	const ctx = canvas.getContext('2d');

	if (vertical) {
		ctx.drawImage(image, srcRect.sx, srcRect.sy, srcRect.sw, srcRect.sh, 0, 0, drawWidth, drawHeight);
	} else {
		ctx.drawImage(image, 0, 0, drawWidth, drawHeight);
	}

	const maxTextWidth = drawWidth * 0.88;
	const startFontSize = Math.max(12, Math.round(drawWidth * (sizePct / 100)));
	const { lines, fontSize } = fitText(ctx, headline, fontFamily, startFontSize, maxTextWidth, maxLines);
	const lineHeight = Math.round(fontSize * 1.35);

	const padding = Math.round(drawHeight * 0.03);
	const blockHeight = lines.length * lineHeight + padding * 2;

	const position = opts.position || 'bottom';
	let blockY;
	if (position === 'top') blockY = 0;
	else if (position === 'center') blockY = Math.round((drawHeight - blockHeight) / 2);
	else blockY = drawHeight - blockHeight;
	blockY = Math.max(0, blockY);

	const opacityPct = Math.max(0, Math.min(100, opts.overlayOpacity ?? 55));
	ctx.fillStyle = hexToRgba(opts.overlayColor || '#000000', opacityPct / 100);
	ctx.fillRect(0, blockY, drawWidth, blockHeight);

	ctx.fillStyle = opts.fontColor || '#ffffff';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';

	let y = blockY + padding + lineHeight * 0.8;
	for (const line of lines) {
		ctx.fillText(line, drawWidth / 2, y);
		y += lineHeight;
	}

	return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

/**
 * Layout 2: bilden orörd överst, texten på ett vitt fält UNDER bilden (svart text).
 * Ökar totalhöjden på canvasen istället för att lägga text ovanpå bilden.
 */
function renderBelowLayout(image, headline, fontFamily, sizePct, maxLines) {
	const width = image.width;
	const imgHeight = image.height;

	// Måttsätt textfältet med en temporär mätnings-canvas (samma bredd som bilden).
	const measureCanvas = createCanvas(width, 10);
	const measureCtx = measureCanvas.getContext('2d');
	const maxTextWidth = width * 0.9;
	const startFontSize = Math.max(12, Math.round(width * (sizePct / 100)));
	const { lines, fontSize } = fitText(measureCtx, headline, fontFamily, startFontSize, maxTextWidth, maxLines);
	const lineHeight = Math.round(fontSize * 1.35);

	const padding = Math.round(width * 0.035);
	const textBlockHeight = lines.length * lineHeight + padding * 2;

	const canvas = createCanvas(width, imgHeight + textBlockHeight);
	const ctx = canvas.getContext('2d');

	// Bilden överst, orörd.
	ctx.drawImage(image, 0, 0, width, imgHeight);

	// Vitt fält under bilden.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, imgHeight, width, textBlockHeight);

	ctx.font = `bold ${fontSize}px "${fontFamily}"`;
	ctx.fillStyle = '#000000';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'alphabetic';

	let y = imgHeight + padding + lineHeight * 0.8;
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
