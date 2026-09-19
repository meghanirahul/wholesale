// app/FirestoreSessionStorage.server.js
//
// Implements Shopify's SessionStorage interface on top of Firestore.
//
// Design notes for the Firestore-backed Shopify session storage:
//
// 1. ONE collection, not two. Sessions live in a single flat collection
//    (`shopify_sessions`), doc ID = session.id. The original draft wrote
//    every session twice — once into `shops/{shop}/sessions/{id}` and once
//    into a `_session_map/{id}` mirror — to work around the fact that
//    loadSession(id) only receives the id, not the shop, so it can't build
//    a subcollection path directly. A single top-level collection makes
//    that mirror unnecessary: loadSession is a direct doc.get() by id, and
//    findSessionsByShop is a `where("shop", "==", shop)` query. Firestore
//    auto-indexes single-field equality filters, so no composite index is
//    needed. Net effect: half the writes on every OAuth/token exchange,
//    and no risk of the two copies drifting out of sync.
//
// 2. deleteSession no longer needs a read-before-write. Because the doc ID
//    IS the session id, we can delete directly instead of first fetching
//    the map doc to discover which shop subcollection to delete from.
//
// 3. `expires` is stored as a native Firestore Timestamp (just let the
//    Firestore SDK serialize the JS Date — don't stringify it). This keeps
//    it queryable/sortable and lets you attach a native Firestore TTL
//    policy so expired sessions are purged automatically server-side
//    instead of accumulating forever (see README for the gcloud command).
//
// 4. A small bounded in-memory cache sits in front of loadSession, because
//    loadSession runs on essentially every authenticated admin/App Bridge
//    request. It's a per-instance optimization only — Firestore is always
//    the source of truth, and store/delete invalidate it, so it can never
//    serve a stale session for longer than CACHE_TTL_MS even across
//    multiple Cloud Run/Fly/etc. instances.

import { Session } from "@shopify/shopify-api";
import { db } from "./shopify.firebase.js";

const COLLECTION = "shopify_sessions";
const sessionsRef = db.collection(COLLECTION);

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // id -> { session, expiresAt }

function cacheGet(id) {
  const hit = cache.get(id);
  if (!hit) return undefined;
  if (hit.expiresAt < Date.now()) {
    cache.delete(id);
    return undefined;
  }
  return hit.session;
}

function cacheSet(id, session) {
  cache.set(id, { session, expiresAt: Date.now() + CACHE_TTL_MS });
}

function cacheDelete(id) {
  cache.delete(id);
}

function toFirestorePayload(session) {
  // toObject() returns plain fields (shop, state, isOnline, scope,
  // expires, accessToken, onlineAccessInfo, id). `expires` stays a Date —
  // the Admin SDK converts it to a Timestamp automatically.
  return session.toObject();
}

function fromFirestorePayload(id, data) {
  const payload = { ...data, id };
  if (payload.expires && typeof payload.expires.toDate === "function") {
    payload.expires = payload.expires.toDate(); // Firestore Timestamp -> Date
  } else if (payload.expires) {
    payload.expires = new Date(payload.expires);
  }
  return new Session(payload);
}

export class FirestoreSessionStorage {
  async storeSession(session) {
    try {
      const data = toFirestorePayload(session);
      // Full overwrite (not merge): a session's shape changes between
      // online/offline, so stale fields from a previous write should not
      // survive.
      await sessionsRef.doc(session.id).set(data);
      cacheSet(session.id, session);
      return true;
    } catch (error) {
      console.error("[FirestoreSessionStorage] storeSession failed:", error);
      return false;
    }
  }

  async loadSession(id) {
    const cached = cacheGet(id);
    if (cached) return cached;

    try {
      const snap = await sessionsRef.doc(id).get();
      if (!snap.exists) return undefined;

      const session = fromFirestorePayload(id, snap.data());
      cacheSet(id, session);
      return session;
    } catch (error) {
      console.error("[FirestoreSessionStorage] loadSession failed:", error);
      return undefined;
    }
  }

  async deleteSession(id) {
    try {
      await sessionsRef.doc(id).delete();
      cacheDelete(id);
      return true;
    } catch (error) {
      console.error("[FirestoreSessionStorage] deleteSession failed:", error);
      return false;
    }
  }

  async deleteSessions(ids) {
    if (!ids || ids.length === 0) return true;
    try {
      // Firestore batches cap out at 500 writes; chunk defensively.
      const CHUNK = 450;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const batch = db.batch();
        chunk.forEach((id) => batch.delete(sessionsRef.doc(id)));
        await batch.commit();
        chunk.forEach(cacheDelete);
      }
      return true;
    } catch (error) {
      console.error("[FirestoreSessionStorage] deleteSessions failed:", error);
      return false;
    }
  }

  async findSessionsByShop(shop) {
    try {
      const snap = await sessionsRef.where("shop", "==", shop).get();
      const sessions = [];
      snap.forEach((doc) => {
        sessions.push(fromFirestorePayload(doc.id, doc.data()));
      });
      return sessions;
    } catch (error) {
      console.error(
        "[FirestoreSessionStorage] findSessionsByShop failed:",
        error,
      );
      return [];
    }
  }
}