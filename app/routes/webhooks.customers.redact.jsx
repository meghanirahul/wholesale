import { authenticate } from "../shopify.server";

/**
 * MANDATORY GDPR webhook — customers/redact
 * Shopify sends this 10 days after a shop owner requests erasure of a
 * customer's data (e.g. after the store has been closed or the customer
 * requests deletion).
 *
 * Requirements:
 *  - Acknowledge immediately with HTTP 200.
 *  - Delete any personal data you hold for the specified customer within
 *    30 days of receiving this webhook.
 *  - This app stores NO customer PII. Wholesale pricing is stored as
 *    metafields keyed by product variant GIDs — not customer identifiers.
 *    Nothing to delete; we still acknowledge immediately.
 */
export const action = async ({ request }) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[webhook] ${topic} for shop=${shop}`, {
        customer_id: payload?.customer?.id,
    });

    // No customer PII stored by this app — acknowledge immediately.
    return new Response(null, { status: 200 });
};
