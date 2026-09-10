// Minimal service worker – dess enda syfte är att göra appen installerbar
// (Android kräver en registrerad service worker för "Lägg till på startskärmen"
// och för att appen ska dyka upp i delningsmenyn). Ingen offline-cachning görs.

self.addEventListener('install', (event) => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	// Passthrough – vi cachar inget, låter allt gå till nätverket som vanligt.
});
