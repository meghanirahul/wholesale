import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // On each app load, ensure the B2B Wholesale Pricing automatic discount
  // exists and is ACTIVE. This removes the need for any manual setup.
  try {
    await ensureDiscountEnabled(admin);
  } catch (e) {
    console.warn("[app.jsx] ensureDiscountEnabled error:", e?.message);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

/**
 * Reads the shop ID + stored discount GID, validates the discount is ACTIVE,
 * and creates/activates it if not found or inactive.
 */
async function ensureDiscountEnabled(admin) {
  // 1. Fetch shop ID and stored discount GID in one call
  const shopRes = await admin.graphql(`#graphql
    query EnsureDiscountShop {
      shop {
        id
        active_discount: metafield(namespace: "$app", key: "active_discount_id") { value }
      }
    }
  `);
  const shopData = await shopRes.json();
  const shopGid = shopData?.data?.shop?.id;
  let discountGid = shopData?.data?.shop?.active_discount?.value ?? null;

  // 2. If stored, verify it's still active
  if (discountGid) {
    const checkRes = await admin.graphql(
      `#graphql
        query CheckDiscountStatus($id: ID!) {
          discountNode(id: $id) {
            discount {
              ... on DiscountAutomaticApp { status }
            }
          }
        }
      `,
      { variables: { id: discountGid } }
    );
    const checkData = await checkRes.json();
    const status = checkData?.data?.discountNode?.discount?.status;

    if (status === "ACTIVE") return; // All good

    if (status === "EXPIRED" || status === "SCHEDULED") {
      // Try to re-enable
      await admin.graphql(
        `#graphql
          mutation ReactivateDiscount($id: ID!) {
            discountAutomaticActivate(id: $id) {
              userErrors { field message }
            }
          }
        `,
        { variables: { id: discountGid } }
      );
      return;
    }

    // Discount node is gone or in an unknown state — recreate
    discountGid = null;
  }

  // 3. Find the Shopify Function by target (apiType)
  const funcRes = await admin.graphql(`#graphql
    query FindWholesaleFunction {
      shopifyFunctions(first: 25) {
        nodes { id title apiType }
      }
    }
  `);
  const funcData = await funcRes.json();
  const fn = funcData?.data?.shopifyFunctions?.nodes?.find(
    (f) =>
      f.apiType === "cart_lines_discounts_generate.run" ||
      (f.handle ?? f.title ?? "").toLowerCase().includes("wholesale")
  );

  if (!fn) {
    console.warn("[ensureDiscountEnabled] Function not found — deploy the extension first.");
    return;
  }

  // 4. Create the automatic discount
  const createRes = await admin.graphql(
    `#graphql
      mutation CreateB2BDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        discount: {
          title: "B2B Wholesale Pricing",
          functionId: fn.id,
          startsAt: new Date().toISOString(),
          discountClasses: ["PRODUCT"],
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
        },
      },
    }
  );
  const createData = await createRes.json();
  const errs = createData?.data?.discountAutomaticAppCreate?.userErrors ?? [];
  if (errs.length) {
    // If "already exists" style error, try to find it instead
    console.warn("[ensureDiscountEnabled] Create userErrors:", errs);
  }
  discountGid =
    createData?.data?.discountAutomaticAppCreate?.automaticAppDiscount
      ?.discountId ?? null;

  if (!discountGid || !shopGid) return;

  // 5. Persist GID to shop metafield
  await admin.graphql(
    `#graphql
      mutation PersistDiscountId($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message }
        }
      }
    `,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "$app",
            key: "active_discount_id",
            type: "single_line_text_field",
            value: discountGid,
          },
        ],
      },
    }
  );
}

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app/pricing-tiers">Tier Pricings</s-link>
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
