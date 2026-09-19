# Block Extension

Admin block extensions enable app developers to build custom functionality into the context of Shopify Admin. These extensions surface as cards at various extension targets and enhance the merchant experience. Developers can build the content of these extensions using Shopify's UI Extension components for Admin.

Learn more about Admin block extensions in Shopify’s [developer documentation](https://shopify.dev/docs/apps/admin/admin-actions-and-blocks).

# Firestore session storage for your Shopify app

## Files

- `app/shopify.firebase.js` — Firebase Admin init, exports `db`. Import this everywhere you need Firestore; don't call `admin.initializeApp()` a second time anywhere else.
- `app/FirestoreSessionStorage.server.js` — the `SessionStorage` implementation backed by Firestore.
- `app/shopify.server.js` — wires `FirestoreSessionStorage` into Shopify via `sessionStorage: new FirestoreSessionStorage()`.

## 1. Configure Firestore session storage

The app's `app/shopify.server.js` already imports and uses `FirestoreSessionStorage`. Keep that session storage configuration and provide the Firebase environment variables below.

## 2. Env vars (same ones you already listed)

```
FIREBASE_TYPE=service_account
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...
FIREBASE_CLIENT_ID=...
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=...
FIREBASE_UNIVERSE_DOMAIN=googleapis.com
```

Pull these straight from the service account JSON you downloaded in the Firebase console (Project Settings → Service accounts → Generate new private key). Paste the `private_key` value with literal `\n` sequences — the code un-escapes them at runtime.

## 3. (Recommended) Auto-expire old sessions with a native TTL policy

Rather than writing your own cron job to delete expired sessions, point Firestore's built-in TTL feature at the `expires` field. Firestore checks TTL-tagged fields for a Timestamp and deletes the document within ~24h after it passes, at no extra write cost:

```bash
gcloud firestore fields ttls update expires \
  --collection-group=shopify_sessions \
  --enable-ttl \
  --project=YOUR_GCP_PROJECT_ID
```

It can take ~10+ minutes to activate after running this. Offline sessions typically have no `expires` value, so they're unaffected — they get cleaned up when you handle the `APP_UNINSTALLED` webhook by calling `sessionStorage.deleteSessions(...)`.

## 4. No manual index needed

`findSessionsByShop` runs a single-field equality query (`where("shop", "==", shop)`), which Firestore indexes automatically. You don't need to touch `firestore.indexes.json` for this.

## Why this storage layout works well for Shopify sessions

| Previous relational storage | This version | Why |
|---|---|---|
| One table, `shop` + `id` columns | One collection, doc ID = `session.id`, `shop` as a field | Firestore doc reads by full path are already O(1); the point of a relational table's primary key doesn't need re-implementing with a second "flat map" collection |
| N/A (SQL handles types) | `db.settings({ ignoreUndefinedProperties: true })` | Offline sessions have `onlineAccessInfo: undefined`; writing that straight to Firestore without this throws and `storeSession` fails silently unless caught |
| N/A | `expires` kept as a native Date/Timestamp, not ISO string | Enables the native TTL policy above and keeps the field sortable/queryable |
| Every `deleteSession` does an extra read first | Direct `delete()` by id | No need to look up "which shop owns this id" — the id is the doc path |
| No cache (every request round-trips to Postgres) | Small per-instance in-memory cache (30s TTL) in front of `loadSession` | `loadSession` runs on effectively every authenticated request; this cuts a Firestore read+network round trip most of the time without ever risking a stale session past 30s, since store/delete invalidate it immediately |
