import { authenticate } from "../shopify.server";
import db from "../shopify.firebase";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    await db.collection("shopify_sessions").doc(session.id).update({
      scope: current.toString(),
    });
  }

  return new Response();
};
