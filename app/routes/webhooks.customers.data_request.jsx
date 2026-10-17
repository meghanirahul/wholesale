import { authenticate } from "../shopify.server";

/**
 * MANDATORY GDPR webhook — customers/data_request
 * Shopify sends this when a customer requests their stored data under GDPR.
 * 
 * Requirements:
 *  - Acknowledge immediately with HTTP 200 (empty body is fine).
 *  - Within 30 days of receiving this, you must send the customer's data
 *    to the shop owner at the email address in the payload.
 *  - This app stores NO personal customer data beyond what Shopify holds.
 *    Metafields are keyed by variant GIDs, not customer data.
 */
export const action = async ({ request }) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[webhook] ${topic} for shop=${shop}`, {
        customer_id: payload?.customer?.id,
        orders_requested: payload?.orders_requested?.length ?? 0,
    });

    // This app stores no personal customer data beyond Shopify-owned metafields.
    // Acknowledge immediately with 200 so Shopify considers the webhook delivered.
    return new Response(null, { status: 200 });
};
