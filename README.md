# Social Poster

En fristående tjänst: dela en länk, få en förhandsgranskning, publicera (eller schemalägg)
till Facebook, X, Mastodon, Bluesky, Threads och LinkedIn.

- Facebook får en bild med en AI-genererad lockande rubrik inritad, plus originaltiteln som
  inläggstext och en automatisk kommentar med länk.
- Alla andra plattformar (X, Mastodon, Bluesky, Threads, LinkedIn) får bara rubrik + länk.

Se **Social-Poster-Driftsattning.docx** för fullständiga instruktioner (installation,
uppgifter per plattform, driftsättning på en server, säkerhet).

## Snabbstart (lokalt)

```bash
npm install
cp .env.example .env
# Redigera .env och sätt ett riktigt ADMIN_PASSWORD
npm start
```

Öppna sedan `http://localhost:3000` i webbläsaren.

## Struktur

- `server.js` – Express-server, alla routes (auth, profiler, kopplingar, förhandsgranskning, publicering)
- `lib/` – kärnlogik (databas, metadata-hämtning, bildmotor, AI-rubriker, typsnitt, schemaläggare)
- `lib/platforms/` – en adapter per social plattform
- `public/` – webbgränssnittet (vanilla JS, ingen byggprocess behövs)
- `data/` – skapas automatiskt, innehåller databasen (`db.json`) och nedladdade typsnitt
