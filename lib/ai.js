const fetch = require('node-fetch');

const LEVEL_MIDPOINTS = { low: 2, medium: 5, high: 8 };

const TECHNIQUE_POOL = [
	'en nyfikenhetslucka (antyd vad som händer utan att avslöja allt, t.ex. "...och sen hände det här")',
	'en konkret siffra eller detalj från sammanhanget',
	'ett starkt känsloladdat ord',
	'en fråga som väcker nyfikenhet',
	'en antydan om en överraskande vändning',
	'ett tidsmässigt driv ("just nu", "efter bara X")',
];

function randomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min, max) {
	return Math.random() * (max - min) + min;
}
function shuffle(arr) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = randomInt(0, i);
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function describeIntensity(intensity) {
	if (intensity <= 2) return 'Håll dig mycket nära originalrubriken, saklig och nykter ton.';
	if (intensity <= 4) return 'Gör rubriken lite mer läsvänlig och intresseväckande, men fortfarande återhållsam.';
	if (intensity <= 6) return 'Gör rubriken tydligt mer lockande och säljande än originalet.';
	if (intensity <= 8) return 'Var påtagligt säljande – väck stark nyfikenhet och använd gärna dramatisk ton.';
	return 'Maximera klickvänligheten med kraftfulla, dramatiska formuleringar – men utan att påstå något osant.';
}

/**
 * Genererar en lockande rubrik baserad på originalrubriken, med en "elastisk" klickvänlighetsnivå:
 * den valda nivån (low/medium/high) är bara en mittpunkt som varje anrop varierar lite kring,
 * plus 1–2 slumpade "knep" ur en pool, så resultatet inte känns som en fast mall.
 *
 * @param {string} title       Originalrubrik.
 * @param {string} description Kort sammanfattning/ingress (valfritt, ger AI:n mer kontext).
 * @param {object} opts
 * @param {string} opts.apiKey   OpenAI API-nyckel. Krävs – kastar annars ett tydligt fel
 *                               (funktionen anropas numera bara när användaren uttryckligen valt den).
 * @param {string} [opts.model='gpt-4o-mini']
 * @param {'low'|'medium'|'high'} [opts.level='high']
 * @returns {Promise<{headline: string, intensity: number, techniques: string[]}>}
 */
async function generateHeadline(title, description, opts = {}) {
	if (!opts.apiKey) {
		throw new Error('Ingen OpenAI API-nyckel konfigurerad. Lägg till en under profilens Inställningar för att kunna använda AI-rubriker.');
	}

	const model = opts.model || 'gpt-4o-mini';
	const midpoint = LEVEL_MIDPOINTS[opts.level] ?? LEVEL_MIDPOINTS.high;
	const jitter = randomFloat(-1.5, 1.5);
	const intensity = Math.round(Math.max(1, Math.min(10, midpoint + jitter)));

	const techniques = shuffle(TECHNIQUE_POOL).slice(0, randomInt(1, 2));
	const intensityText = describeIntensity(intensity);

	const systemPrompt =
		'Du skriver korta rubriker på svenska för sociala medier som ska få folk att klicka och läsa mer. ' +
		`Skriv med klickvänlighetsintensitet ${intensity} av 10, där 1 är en helt saklig, neutral nyhetsrubrik ` +
		`och 10 är maximalt säljande clickbait. ${intensityText} ` +
		`Ta gärna inspiration av (men känn dig inte tvingad att använda alla): ${techniques.join('; ')}. ` +
		'Variera formuleringar och grepp mellan olika rubriker – undvik att alltid falla tillbaka på samma mönster. ' +
		'Behåll sakinnehållet korrekt och skapa aldrig rubriker som är faktamässigt vilseledande, oavsett intensitet. ' +
		'Max cirka 90 tecken. Svara ENDAST med den nya rubriken, utan citattecken, utan förklaring.';

	let userPrompt = `Originalrubrik: "${title}"`;
	if (description) userPrompt += `\nSammanfattning av artikeln: ${description}`;

	const temperature = Math.min(1.0, Math.max(0.5, 0.55 + (intensity / 10) * 0.3 + randomFloat(-0.05, 0.05)));

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}` },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature: Math.round(temperature * 100) / 100,
			max_tokens: 100,
		}),
		timeout: 20000,
	});

	const body = await response.json();
	if (!response.ok || !body?.choices?.[0]?.message?.content) {
		const msg = body?.error?.message || `HTTP ${response.status}`;
		throw new Error(`OpenAI svarade med fel: ${msg}`);
	}

	let headline = body.choices[0].message.content.trim();
	headline = headline.replace(/^["']|["']$/g, '');

	return { headline: headline || title, intensity, techniques };
}

/**
 * Genererar en neutral, proffsig omskrivning av rubriken – korrigerar ev. stav-/grammatikfel
 * och gör den lite mer läsvänlig, men lägger INTE till någon säljande eller dramatisk ton.
 * Ingen "intensitet" här, bara en enkel korrekturläsnings-/redigeringspass.
 *
 * @param {string} title
 * @param {string} description
 * @param {object} opts { apiKey, model }
 * @returns {Promise<{headline: string}>}
 */
async function generateNeutralHeadline(title, description, opts = {}) {
	if (!opts.apiKey) {
		throw new Error('Ingen OpenAI API-nyckel konfigurerad. Lägg till en under profilens Inställningar för att kunna använda AI-rubriker.');
	}

	const model = opts.model || 'gpt-4o-mini';

	const systemPrompt =
		'Du är en skicklig nyhetsredaktör. Skriv om rubriken så att den blir så tydlig, korrekt och proffsig ' +
		'som möjligt – som en riktigt bra rubrik i en etablerad tidning. Rätta eventuella stav- eller ' +
		'grammatikfel, och gör den gärna lite mer koncis och läsvänlig. Lägg INTE till någon säljande, ' +
		'dramatisk eller sensationell ton – håll dig strikt saklig och neutral. Behåll exakt samma ' +
		'sakinnehåll som originalet. Max cirka 90 tecken. Svara ENDAST med den nya rubriken, utan ' +
		'citattecken, utan förklaring.';

	let userPrompt = `Originalrubrik: "${title}"`;
	if (description) userPrompt += `\nSammanfattning av artikeln: ${description}`;

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}` },
		body: JSON.stringify({
			model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt },
			],
			temperature: 0.5,
			max_tokens: 100,
		}),
		timeout: 20000,
	});

	const body = await response.json();
	if (!response.ok || !body?.choices?.[0]?.message?.content) {
		const msg = body?.error?.message || `HTTP ${response.status}`;
		throw new Error(`OpenAI svarade med fel: ${msg}`);
	}

	let headline = body.choices[0].message.content.trim();
	headline = headline.replace(/^["']|["']$/g, '');

	return { headline: headline || title };
}

module.exports = { generateHeadline, generateNeutralHeadline };
