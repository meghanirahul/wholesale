import { Outlet, useLoaderData, useRouteError } from "react-router";
import { useEffect } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // On each app load, ensure all 3 discount nodes exist and are ACTIVE.
  // Seeds tier_customer_tags metafield on new nodes. Preserves existing configs.
  try {
    await ensureDiscountEnabled(admin);
  } catch (e) {
    console.warn("[app.jsx] ensureDiscountEnabled error:", e?.message);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// ── Tier configuration ─────────────────────────────────────────────────────────
// handle must match shopify.extension.toml exactly.
const TIER_CONFIGS = [
  {
    key: "vip_pricing",
    qtyKey: "vip_pricing_min",
    title: "VIP Wholesale Pricing",
    handle: "wholesale-price-discount",
  },
  {
    key: "wholesale_pricing",
    qtyKey: "wholesale_pricing_min",
    title: "Wholesale Tier Pricing",
    handle: "wholesale-tier-discount",
  },
  {
    key: "b2b_pricing",
    qtyKey: "b2b_pricing_min",
    title: "B2B Tier Pricing",
    handle: "b2b-tier-discount",
  },
];

/**
 * Finds a Shopify Function by its extension handle.
 * Tries exact, partial, then title-based match.
 */
async function findFunctionByHandle(admin, handle) {
  const res = await admin.graphql(`#graphql
    query FindFunctionByHandle {
      shopifyFunctions(first: 50) {
        nodes { id handle title apiType }
      }
    }
  `);
  const data = await res.json();
  const fns = data?.data?.shopifyFunctions?.nodes ?? [];
  let fn = fns.find((f) => f.handle === handle);
  if (!fn) fn = fns.find((f) => (f.handle ?? "").includes(handle) || handle.includes(f.handle ?? ""));
  if (!fn) fn = fns.find((f) => (f.title ?? "").toLowerCase().includes(handle.toLowerCase()));
  if (fn) {
    console.log(`[findFunctionByHandle] Found: id=${fn.id} handle=${fn.handle}`);
  } else {
    console.warn(`[findFunctionByHandle] NOT FOUND for handle="${handle}"`);
  }
  return fn ?? null;
}

/**
 * Ensures all 3 tier discount nodes exist and are ACTIVE.
 * For NEW nodes: seeds tier_customer_tags with default empty-tags config.
 * For EXISTING nodes: preserves tier_customer_tags (merchant-set tags NOT overwritten).
 * Syncs tier_customer_tags only when the node has no existing config.
 */
async function ensureDiscountEnabled(admin) {
  // 1. Fetch shop data
  const shopRes = await admin.graphql(`#graphql
    query EnsureDiscountsShop {
      shop {
        id
        active_discounts: metafield(namespace: "$app", key: "active_tier_discounts") { value }
        legacy_discount: metafield(namespace: "$app", key: "active_discount_id") { value }
      }
    }
  `);
  const shopData = await shopRes.json();
  const shop = shopData?.data?.shop;
  const shopGid = shop?.id;
  if (!shopGid) {
    console.warn("[ensureDiscountEnabled] Could not fetch shop ID");
    return;
  }

  let storedMap = {};
  try {
    if (shop?.active_discounts?.value) storedMap = JSON.parse(shop.active_discounts.value);
  } catch { storedMap = {}; }

  const updatedMap = { ...storedMap };
  const metafieldsToWrite = [];     // tier_customer_tags for new/missing nodes only
  const shopMetafields = [];        // active_tier_discounts + active_discount_id

  for (const tier of TIER_CONFIGS) {
    const fn = await findFunctionByHandle(admin, tier.handle);
    if (!fn) {
      console.warn(`[ensureDiscountEnabled] Skipping ${tier.key} — handle "${tier.handle}" not found`);
      continue;
    }

    let discountGid = updatedMap[tier.key] ||
      (tier.key === "vip_pricing" ? shop?.legacy_discount?.value : null);
    let isActive = false;
    let hasExistingConfig = false;

    if (discountGid) {
      try {
        const checkRes = await admin.graphql(
          `#graphql
            query CheckDiscountNode($id: ID!) {
              discountNode(id: $id) {
                discount { ... on DiscountAutomaticApp { status } }
                tier_cfg: metafield(namespace: "$app", key: "tier_customer_tags") { value }
              }
            }
          `,
          { variables: { id: discountGid } }
        );
        const checkData = await checkRes.json();
        const node = checkData?.data?.discountNode;
        const status = node?.discount?.status;
        console.log(`[ensureDiscountEnabled] ${tier.key} status: ${status}`);

        // Check if tier_customer_tags already has tags set by the merchant
        const existingCfgRaw = node?.tier_cfg?.value;
        if (existingCfgRaw) {
          try {
            const existingCfg = JSON.parse(existingCfgRaw);
            hasExistingConfig = Array.isArray(existingCfg?.tags);
          } catch { hasExistingConfig = false; }
        }

        if (status === "ACTIVE") {
          isActive = true;
        } else if (status === "EXPIRED" || status === "SCHEDULED") {
          await admin.graphql(
            `#graphql
              mutation ReactivateDiscount($id: ID!) {
                discountAutomaticActivate(id: $id) { userErrors { field message } }
              }
            `,
            { variables: { id: discountGid } }
          );
          isActive = true;
          console.log(`[ensureDiscountEnabled] Reactivated ${tier.key}`);
        }
      } catch (e) {
        console.warn(`[ensureDiscountEnabled] Error checking ${tier.key}:`, e?.message);
        isActive = false;
      }
    }

    // Auto-create if not found / not active
    if (!isActive) {
      console.log(`[ensureDiscountEnabled] Creating discount for ${tier.key} (fn=${fn.id})`);

      // Default config with empty tags. Merchant sets real tags via saveTags.
      const defaultConfig = {
        tags: [],
        priceKey: tier.key,
        qtyKey: tier.qtyKey,
        tierName: tier.title,
        tiers: {},
      };

      const createRes = await admin.graphql(
        `#graphql
          mutation CreateTierDiscount($discount: DiscountAutomaticAppInput!) {
            discountAutomaticAppCreate(automaticAppDiscount: $discount) {
              automaticAppDiscount { discountId }
              userErrors { field message }
            }
          }
        `,
        {
          variables: {
            discount: {
              title: tier.title,
              functionId: fn.id,
              startsAt: new Date().toISOString(),
              discountClasses: ["PRODUCT"],
              combinesWith: {
                orderDiscounts: true,
                productDiscounts: true,
                shippingDiscounts: true,
              },
              // Seed tier_customer_tags immediately so Shopify's input_variables
              // mechanism can inject $tags, $priceKey, $qtyKey right away.
              metafields: [
                {
                  namespace: "$app",
                  key: "tier_customer_tags",
                  type: "json",
                  value: JSON.stringify(defaultConfig),
                },
              ],
            },
          },
        }
      );
      const createData = await createRes.json();
      const createErrors = createData?.data?.discountAutomaticAppCreate?.userErrors ?? [];
      if (createErrors.length) {
        console.error(`[ensureDiscountEnabled] Create errors for ${tier.key}:`, createErrors.map((e) => e.message).join("; "));
      }
      const newId = createData?.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId ?? null;
      if (newId) {
        discountGid = newId;
        updatedMap[tier.key] = newId;
        hasExistingConfig = true; // already seeded via mutation
        console.log(`[ensureDiscountEnabled] Created ${tier.key}: ${newId}`);
      }
    }

    if (discountGid) {
      updatedMap[tier.key] = discountGid;

      // Only write tier_customer_tags if config is completely missing.
      // Never overwrite merchant-configured tags.
      if (!hasExistingConfig) {
        metafieldsToWrite.push({
          ownerId: discountGid,
          namespace: "$app",
          key: "tier_customer_tags",
          type: "json",
          value: JSON.stringify({
            tags: [],
            priceKey: tier.key,
            qtyKey: tier.qtyKey,
            tierName: tier.title,
            tiers: {},
          }),
        });
      }
    }
  }

  // 2. Persist updated discount IDs to shop
  shopMetafields.push({
    ownerId: shopGid,
    namespace: "$app",
    key: "active_tier_discounts",
    type: "json",
    value: JSON.stringify(updatedMap),
  });

  const primaryId = updatedMap.vip_pricing || updatedMap.wholesale_pricing || updatedMap.b2b_pricing;
  if (primaryId) {
    shopMetafields.push({
      ownerId: shopGid,
      namespace: "$app",
      key: "active_discount_id",
      type: "single_line_text_field",
      value: primaryId,
    });
  }

  // 3. Write everything — shop IDs + any missing tier_customer_tags
  const allMetafields = [...shopMetafields, ...metafieldsToWrite];
  if (allMetafields.length > 0) {
    await admin.graphql(
      `#graphql
        mutation PersistDiscountState($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors { field message }
          }
        }
      `,
      { variables: { metafields: allMetafields } }
    );
    console.log(`[ensureDiscountEnabled] Wrote ${allMetafields.length} metafields`);
  }
}

export default function App() {
  const { apiKey } = useLoaderData();

  // Inject Tawk.to live-chat script once on mount
  useEffect(() => {
    if (document.getElementById("tawk-script")) return;
    const s0 = document.getElementsByTagName("script")[0];
    const s1 = document.createElement("script");
    s1.id = "tawk-script";
    s1.async = true;
    s1.src = "https://embed.tawk.to/6a411b59762a271d420a050e/1js755med";
    s1.charset = "UTF-8";
    s1.setAttribute("crossorigin", "*");
    s0.parentNode.insertBefore(s1, s0);
  }, []);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/pricing-tiers">Pricings</s-link>
        <s-link href="/app/about">About Us</s-link>
        <s-link href="/app/contact">Contact Us</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
