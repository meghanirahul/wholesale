// app/services/tierStorage.server.js
//
// Manages store-specific tier tag configuration in Firestore.
// Enables multi-store isolation and persistent tier-to-tag mappings per shop domain.

import { db } from "../shopify.firebase.js";

const STORES_COLLECTION = "stores";

/**
 * Saves the store's tier_tags_map to Firestore.
 * Collection: `stores`, Document ID: `shopDomain`
 * @param {string} shopDomain - e.g. "my-store.myshopify.com"
 * @param {Record<string, string[]>} tierTagsMap - e.g. { "wholesale_pricing": ["wholesale", "b2b"] }
 */
export async function saveStoreTierTags(shopDomain, tierTagsMap) {
    if (!shopDomain) return;
    try {
        const storeRef = db.collection(STORES_COLLECTION).doc(shopDomain);
        await storeRef.set(
            {
                tier_tags_map: tierTagsMap,
                updatedAt: new Date().toISOString(),
            },
            { merge: true }
        );
    } catch (error) {
        console.error(`[saveStoreTierTags] Error saving for shop ${shopDomain}:`, error);
    }
}

/**
 * Retrieves the store's tier_tags_map from Firestore.
 * @param {string} shopDomain - e.g. "my-store.myshopify.com"
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getStoreTierTags(shopDomain) {
    if (!shopDomain) return {};
    try {
        const doc = await db.collection(STORES_COLLECTION).doc(shopDomain).get();
        if (!doc.exists) return {};
        return doc.data()?.tier_tags_map ?? {};
    } catch (error) {
        console.error(`[getStoreTierTags] Error fetching for shop ${shopDomain}:`, error);
        return {};
    }
}
