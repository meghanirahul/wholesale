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

    const defMap = {};
    for (const def of definitionNodes) {
        defMap[def.key] = def;
    }

    const tiers = Object.keys(defMap)
        .filter((key) => key.endsWith("_pricing"))
        .map((priceKey) => {
            const priceDef = defMap[priceKey];
            const qtyKey = `${priceKey}_min`;
            const qtyDef = defMap[qtyKey] ?? null;
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

    return (
        <s-page
            heading="Pricing Tiers"
            description="Select a tier to set per-variant wholesale prices and minimum order quantities. Discounts apply automatically at checkout via Shopify Functions."
        >
            <s-section heading="Your pricing tiers">
                {tiers.length === 0 ? (
                    <s-banner tone="info">
                        No wholesale pricing tiers found. Add variant metafield definitions
                        with keys ending in <s-text type="code">_pricing</s-text> in Shopify
                        Admin → Settings → Custom data → Product variants.
                    </s-banner>
                ) : (
                    <s-grid columns="3" gap="base">
                        {tiers.map((tier) => (
                            <s-clickable
                                key={tier.numericId || tier.priceKey}
                                onClick={() => navigate(`/app/pricing?id=${tier.numericId}`)}
                                padding="base"
                                borderRadius="base"
                                border="base"
                            >
                                <s-stack direction="block" gap="small-400">
                                    <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                                        <s-text type="heading">{tier.name}</s-text>
                                        <s-badge tone="success">Active</s-badge>
                                    </s-stack>

                                    <s-stack direction="block" gap="small-200">
                                        <s-stack direction="inline" gap="small-300" alignItems="center">
                                            <s-text tone="subdued">Price key:</s-text>
                                            <s-text type="code">{tier.priceKey}</s-text>
                                        </s-stack>
                                        {tier.qtyKey && (
                                            <s-stack direction="inline" gap="small-300" alignItems="center">
                                                <s-text tone="subdued">Min qty key:</s-text>
                                                <s-text type="code">{tier.qtyKey}</s-text>
                                            </s-stack>
                                        )}
                                    </s-stack>

                                    <s-stack direction="inline" justifyContent="end">
                                        <s-text tone="subdued">Edit pricing →</s-text>
                                    </s-stack>
                                </s-stack>
                            </s-clickable>
                        ))}
                    </s-grid>
                )}
            </s-section>
        </s-page>
    );
}