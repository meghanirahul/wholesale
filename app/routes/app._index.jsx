import { authenticate } from "../shopify.server";
import { useLoaderData, useNavigate } from "react-router";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const tiersResponse = await admin.graphql(
    `#graphql
    query MetafieldDefinitions {
      metafieldDefinitions(
        first: 100
        namespace: "$app"
        ownerType: PRODUCTVARIANT
      ) {
        nodes {
          id
          key
          name
          type {
            name
          }
        }
      }
    }
    `
  );

  const getTiers = await tiersResponse.json();
  const definitionNodes = getTiers?.data?.metafieldDefinitions?.nodes ?? [];

  // Map definitions by key
  const defMap = {};
  for (const def of definitionNodes) {
    defMap[def.key] = def;
  }

  // Automatically discover and sync tiers as in the variant block:
  // - Any key ending with "_pricing" is a price definition
  // - Companion quantity definition is "${priceKey}_min"
  const tiers = Object.keys(defMap)
    .filter((key) => key.endsWith("_pricing"))
    .map((priceKey) => {
      const priceDef = defMap[priceKey];
      const qtyKey = `${priceKey}_min`;
      const qtyDef = defMap[qtyKey] ?? null;

      // Extract numeric ID only from the GID (e.g. "gid://shopify/MetafieldDefinition/12345" -> "12345")
      const numericId = priceDef.id ? priceDef.id.split("/").pop() : "";

      return {
        id: priceDef.id,
        numericId,
        name: priceDef.name,
        priceKey,
        priceType: priceDef.type?.name ?? "money",
        qtyKey: qtyDef ? qtyKey : null,
        qtyId: qtyDef?.id ?? null,
        qtyNumericId: qtyDef?.id ? qtyDef.id.split("/").pop() : null,
        qtyName: qtyDef?.name ?? null,
      };
    });

  return { tiers };
};

export default function PricingTiers() {
  const { tiers = [] } = useLoaderData();
  const navigate = useNavigate();
  console.log(tiers)

  return (
    <s-page heading="Tier Pricings">
      <s-section>
        {tiers.length === 0 ? (
          <s-banner tone="info">
            No wholesale pricing tiers found. Add variant metafield definitions in your app configuration.
          </s-banner>
        ) : (
          <s-grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap="base">
            {tiers.map((tier) => (
              <s-clickable
                key={tier.numericId || tier.priceKey}
                href={`/app/pricing?id=${tier.numericId}`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/app/pricing?id=${tier.numericId}`);
                }}
                padding="base"
                borderRadius="base"
                border="base"
              >
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{tier.name}</s-text>
                  <s-text tone="neutral">Pricing Key: {tier.priceKey}</s-text>
                  {tier.qtyKey ? (
                    <s-text tone="neutral">Min Quantity: {tier.qtyName || tier.qtyKey}</s-text>
                  ) : null}
                </s-stack>
              </s-clickable>
            ))}
          </s-grid>
        )}
      </s-section>
    </s-page>
  );
}