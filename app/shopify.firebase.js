// app/shopify.firebase.js
//
// Single place where the Firebase Admin SDK is initialized and the
// Firestore client is created. Everything else (session storage, any
// app-data repositories you add later) should import `db` from here
// instead of calling admin.initializeApp() again.

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  // Env vars store literal "\n" — turn them back into real newlines.
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : undefined,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
};

// Guard against "app already exists" crashes. This matters a lot for
// Shopify/Remix apps: Vite's dev server and some serverless runtimes can
// re-evaluate this module multiple times in the same process.
if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export const db = getFirestore();

// Without this, writing a session object that contains an `undefined`
// field (e.g. `onlineAccessInfo` on an offline session) throws
// "Cannot use 'undefined' as a Firestore value" and storeSession() fails
// silently unless you catch it. This makes Firestore drop undefined
// fields instead of throwing, which matches how Shopify's Session object
// actually behaves (fields are optional depending on session type).
db.settings({ ignoreUndefinedProperties: true });

export default db;
