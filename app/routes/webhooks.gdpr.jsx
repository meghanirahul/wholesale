import { authenticate } from "../shopify.server";
import db from "../shopify.firebase";

/**
 * MANDATORY GDPR compliance webhook handler.
 *
 * All three compliance topics route here via shopify.app.toml:
 *   - customers/data_request  → acknowledge; app stores no customer PII
 *   - customers/redact        → acknowledge; nothing to delete
 *   - shop/redact             → acknowledge + fire-and-forget Firestore session purge
 *
 * Critical: return HTTP 200 IMMEDIATELY. Never let async work delay the response.
 * Shopify retries on failure and counts slow responses as failures.
 */
export const action = async ({ request }) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[webhook:gdpr] topic=${topic} shop=${shop}`);

    if (topic === "CUSTOMERS_DATA_REQUEST") {
        // Customer requested a copy of their data.
        // This app stores no personal customer data — metafields are keyed by
        // product variant GIDs, not customer identifiers.
        console.log(`[webhook:gdpr] customers/data_request — no PII stored. customer_id=${payload?.customer?.id}`);
    }

    else if (topic === "CUSTOMERS_REDACT") {
        // Customer requested erasure of their data.
        // Nothing to delete — acknowledge and move on.
        console.log(`[webhook:gdpr] customers/redact — no PII stored. customer_id=${payload?.customer?.id}`);
    }

    else if (topic === "SHOP_REDACT") {
        // Shop requested erasure of all its data (sent 48h after uninstall).
        // Fire-and-forget Firestore session cleanup so the 200 is never delayed.
        (async () => {
            try {
                const sessions = await db
                    .collection("shopify_sessions")
                    .where("shop", "==", shop)
                    .get();

                if (!sessions.empty) {
                    const batch = db.batch();
                    sessions.forEach((doc) => batch.delete(doc.ref));
                    await batch.commit();
                    console.log(`[webhook:gdpr] shop/redact — deleted ${sessions.size} session(s) for shop=${shop}`);
                } else {
                    console.log(`[webhook:gdpr] shop/redact — no sessions found for shop=${shop}`);
                }
            } catch (err) {
                console.error(`[webhook:gdpr] shop/redact Firestore error for shop=${shop}:`, err);
            }
        })();
    }

    // Always respond 200 immediately — never block on async cleanup.
    return new Response(null, { status: 200 });
};
