const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'db.json');

const defaultData = {
	profiles: [],       // { id, name, createdAt, connections: { facebook: {...}, x: {...}, mastodon: {...}, bluesky: {...}, threads: {...}, linkedin: {...} }, settings: {...} }
	posts: [],           // historik + schemalagda inlägg
	oauthStates: []       // tillfälliga state-värden för LinkedIn OAuth-flödet
};

let dbInstance = null;

async function getDb() {
	if (dbInstance) return dbInstance;
	fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
	const adapter = new JSONFile(DB_PATH);
	const db = new Low(adapter, defaultData);
	await db.read();
	db.data ||= structuredClone(defaultData);
	// Säkerställ att alla toppnivånycklar finns även i en äldre datafil.
	for (const key of Object.keys(defaultData)) {
		if (!(key in db.data)) db.data[key] = structuredClone(defaultData[key]);
	}
	await db.write();
	dbInstance = db;
	return db;
}

function newId() {
	return randomUUID();
}

module.exports = { getDb, newId, DB_PATH };
