import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseMoneyAmount(rawValue) {
  if (!rawValue) return null;
  try {
    const obj = JSON.parse(rawValue);
    return obj?.amount ?? null;
  } catch {
    return null;
  }
}

function buildTiersFromDefinitions(definitionEdges) {
  const defMap = {};
  for (const { node: def } of definitionEdges) {
    defMap[def.key] = { key: def.key, name: def.name, type: def.type.name };
  }
  const tiers = [];
  for (const key of Object.keys(defMap)) {
    if (key.endsWith("_pricing")) {
      const qtyKey = `${key}_min`;
      tiers.push({
        label: defMap[key].name,
        priceKey: key,
        qtyKey: defMap[qtyKey] ? qtyKey : null,
      });
    }
  }
  return tiers;
}

// ─── Extension ────────────────────────────────────────────────────────────────

function Extension() {
  const { data, navigation } = shopify;
  const productId = data.selected[0].id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [productTitle, setProductTitle] = useState("");
  const [variants, setVariants] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [defEdges, setDefEdges] = useState([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("shopify:admin/api/graphql.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query WholesaleBlockData($productId: ID!) {
              metafieldDefinitions(first: 100, namespace: "$app", ownerType: PRODUCTVARIANT) {
                edges {
                  node { id key name type { name } }
                }
              }
              product(id: $productId) {
                title
                variants(first: 100) {
                  nodes {
                    id title price
                    metafields(namespace: "$app", first: 100) {
                      edges {
                        node { id key type value }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: { productId },
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const json = await response.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);

      const edges = json.data?.metafieldDefinitions?.edges ?? [];
      const product = json.data?.product;
      if (!product) throw new Error("Product not found.");

      const discoveredTiers = buildTiersFromDefinitions(edges);
      setDefEdges(edges);
      setTiers(discoveredTiers);
      setProductTitle(product.title ?? "");
      setVariants(product.variants?.nodes ?? []);
    } catch (err) {
      console.error("Block fetch error:", err);
      setError(err?.message ?? "Failed to load pricing data.");
    } finally {
      setLoading(false);
    }
  };

  const openModal = () => {
    navigation.navigate("extension:wholesale-price-action");
  };

  // Build a summary: for each tier, count variants that have a price set
  const tierSummaries = tiers.map((tier) => {
    let setCount = 0;
    for (const v of variants) {
      const mfEdges = v.metafields?.edges ?? [];
      const mf = mfEdges.find(({ node }) => node.key === tier.priceKey);
      if (mf && parseMoneyAmount(mf.node.value) !== null) setCount++;
    }
    return { ...tier, setCount, total: variants.length };
  });

  return (
    <s-admin-block heading="Wholesale Pricing">
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}

        {loading ? (
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-spinner />
            <s-text tone="subdued">Loading pricing...</s-text>
          </s-stack>
        ) : tiers.length === 0 ? (
          <s-text tone="subdued">No wholesale pricing tiers configured.</s-text>
        ) : (
          <s-stack direction="block" gap="small">
            {tierSummaries.map((tier) => (
              <s-stack
                key={tier.priceKey}
                direction="inline"
                gap="small"
                justifyContent="space-between"
                alignItems="center"
              >
                <s-text type="strong">{tier.label}</s-text>
                <s-badge
                  tone={tier.setCount === tier.total ? "success" : tier.setCount > 0 ? "warning" : "default"}
                >
                  {tier.setCount}/{tier.total} variants priced
                </s-badge>
              </s-stack>
            ))}
          </s-stack>
        )}

        <s-stack direction="inline" justifyContent="start">
          <s-button onClick={openModal} disabled={loading}>
            Set Wholesale Pricing
          </s-button>
        </s-stack>
      </s-stack>
    </s-admin-block>
  );
}