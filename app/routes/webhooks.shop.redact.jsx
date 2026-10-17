import { authenticate } from "../shopify.server";
import db from "../shopify.firebase";

/**
 * MANDATORY GDPR webhook — shop/redact
 * Shopify sends this 48 hours after a shop uninstalls the app, to request
 * erasure of all shop-level data.
 *
 * Requirements:
 *  - Acknowledge immediately with HTTP 200.
 *  - Delete any shop-specific data you hold within 30 days.
 *  - This app stores session data in Firestore keyed by shop domain.
 *    We purge those sessions here in addition to the instant 200 response.
 */
export const action = async ({ request }) => {
    const { topic, shop } = await authenticate.webhook(request);

    console.log(`[webhook] ${topic} for shop=${shop} — purging Firestore sessions`);

    // Fire-and-forget: best-effort Firestore cleanup.
    // The 200 is returned immediately below; cleanup runs in the background.
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
                console.log(
                    `[shop/redact] Deleted ${sessions.size} session(s) for shop=${shop}`
                );
            } else {
                console.log(`[shop/redact] No sessions found for shop=${shop}`);
            }
        } catch (err) {
            console.error(`[shop/redact] Firestore cleanup error for shop=${shop}:`, err);
        }
    })();

    // Respond 200 immediately — never let cleanup delay the acknowledgement.
    return new Response(null, { status: 200 });
};
