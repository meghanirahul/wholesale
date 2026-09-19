import { authenticate } from "../shopify.server";
import db from "../shopify.firebase";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    const sessions = await db
      .collection("shopify_sessions")
      .where("shop", "==", shop)
      .get();
    const batch = db.batch();
    sessions.forEach((sessionDoc) => batch.delete(sessionDoc.ref));
    await batch.commit();
  }

  return new Response();
};
