/* eslint-disable react/prop-types */
import { authenticate } from "../shopify.server";
import { useLoaderData, useFetcher } from "react-router";
import { useState, useRef, useEffect, Fragment } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseMoneyAmount(rawValue) {
  if (!rawValue) return null;
  try {
    const obj = JSON.parse(rawValue);
    return obj?.amount ?? null;
  } catch {
    return null;
  }
}

function editKey(variantId, mfKey) {
  return `${variantId}::${mfKey}`;
}

function mergeVariantsIntoEdits(editsMap, productsList, priceKey, qtyKey) {
  const nextEdits = { ...editsMap };
  for (const prod of productsList) {
    const variants = prod.variants?.nodes ?? [];
    for (const v of variants) {
      if (priceKey) {
        const pk = editKey(v.id, priceKey);
        if (!(pk in nextEdits)) {
          const mf = v.metafields?.nodes?.find((m) => m.key === priceKey);
          const orig = mf ? (parseMoneyAmount(mf.value) ?? v.price) : v.price;
          nextEdits[pk] = { value: orig, originalValue: orig, type: "money", key: priceKey, ownerId: v.id };
        }
      }
      if (qtyKey) {
        const qk = editKey(v.id, qtyKey);
        if (!(qk in nextEdits)) {
          const mfQ = v.metafields?.nodes?.find((m) => m.key === qtyKey);
          const origQ = mfQ?.value ?? "1";
          nextEdits[qk] = { value: origQ, originalValue: origQ, type: "number_integer", key: qtyKey, ownerId: v.id };
        }
      }
    }
  }
  return nextEdits;
}

// ─── Row Components ───────────────────────────────────────────────────────────

/**
 * ProductRow renders the 5 columns for a product:
 * 1. Image: Media preview thumbnail or default image icon
 * 2. Title: Product title and multi-variant badge with expand/collapse toggle
 * 3. Price: Editable B2B tier price (for single-variant) or price range (for multi-variant)
 * 4. Quantity: Editable Min Quantity (for single-variant) or "—" (rendered when qtyKey exists)
 * 5. Regular Price: Disabled variant regular price (for single-variant) or "—"
 */
function ProductRow({
  product,
  qtyKey,
  isExpanded,
  onToggleExpand,
  getPriceValue,
  getQtyValue,
  onPriceChange,
  onQtyChange,
  disabled,
}) {
  const count = product.variantsCount?.count ?? product.variants?.nodes?.length ?? 1;
  const isSingle = count === 1;
  const singleVariant = isSingle ? product.variants?.nodes?.[0] : null;
  const imageUrl = product?.media?.nodes?.[0]?.preview?.image?.url;

  return (
    <s-table-row>
      {/* 1. Image */}
      <s-table-cell>
        <s-grid maxInlineSize="40px" justifyContent="center">
          {imageUrl ? (
            <s-image
              alt={product.title}
              src={imageUrl}
              aspectRatio="1 / 1"
              objectFit="cover"
              borderRadius="base"
              inlineSize="fill"
            />
          ) : (
            <s-icon type="image" size="40" />
          )}
        </s-grid>
      </s-table-cell>

      {/* 2. Title */}
      <s-table-cell>
        <s-stack direction="block" gap="small-500">
          <s-text type="strong">{product.title}</s-text>
          {!isSingle && (
            <s-stack direction="inline" gap="small-400" justifyContent="start" alignItems="center">
              <s-badge tone="neutral">{count} variants</s-badge>
              <s-button
                variant="tertiary"
                icon={isExpanded ? "caret-down" : "caret-right"}
                onClick={() => onToggleExpand(product)}
              >
                {isExpanded ? "Hide variants" : "Show variants"}
              </s-button>
            </s-stack>
          )}
        </s-stack>
      </s-table-cell>

      {/* 3. Price (B2B Price) */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          {isSingle && singleVariant ? (
            <s-money-field
              value={getPriceValue(singleVariant)}
              min={0}
              disabled={disabled}
              onChange={(e) =>
                onPriceChange(singleVariant, e.currentTarget?.value ?? e.target?.value)
              }
            />
          ) : (
            <s-text tone="subdued">
              {product.priceRangeV2?.minVariantPrice?.amount} — {product.priceRangeV2?.maxVariantPrice?.amount}
            </s-text>
          )}
        </s-stack>
      </s-table-cell>

      {/* 4. Quantity (Min Quantity, when qtyKey exists) */}
      {qtyKey && (
        <s-table-cell>
          <s-stack maxInlineSize="90px">
            {isSingle && singleVariant ? (
              <s-number-field
                min={1}
                step={1}
                value={getQtyValue(singleVariant)}
                disabled={disabled}
                onChange={(e) =>
                  onQtyChange(singleVariant, e.currentTarget?.value ?? e.target?.value)
                }
              />
            ) : (
              <s-text tone="subdued">—</s-text>
            )}
          </s-stack>
        </s-table-cell>
      )}

      {/* 5. Disabled Regular Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          {isSingle && singleVariant ? (
            <s-money-field value={singleVariant.price} disabled />
          ) : (
            <s-text tone="subdued">—</s-text>
          )}
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

/**
 * VariantRow renders the 5 columns for an expanded variant row:
 * 1. Image indicator (tree sub-arrow)
 * 2. Variant Title (indented)
 * 3. B2B Tier Price (editable money field)
 * 4. Min Quantity (editable integer field; rendered when qtyKey exists)
 * 5. Disabled Regular Price (disabled money field)
 */
function VariantRow({
  variant,
  qtyKey,
  getPriceValue,
  getQtyValue,
  onPriceChange,
  onQtyChange,
  disabled,
}) {
  return (
    <s-table-row key={variant.id}>
      {/* 1. Image / Sub-variant indicator */}
      <s-table-cell>
        <s-stack maxInlineSize="40px" justifyContent="center" alignItems="center">
          <s-text tone="subdued">↳</s-text>
        </s-stack>
      </s-table-cell>

      {/* 2. Title */}
      <s-table-cell>
        <s-box paddingInlineStart="base">
          <s-text tone="subdued">{variant.title}</s-text>
        </s-box>
      </s-table-cell>

      {/* 3. Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          <s-money-field
            value={getPriceValue(variant)}
            min={0}
            disabled={disabled}
            onChange={(e) =>
              onPriceChange(variant, e.currentTarget?.value ?? e.target?.value)
            }
          />
        </s-stack>
      </s-table-cell>

      {/* 4. Min Quantity (if qtyKey exists) */}
      {qtyKey && (
        <s-table-cell>
          <s-stack maxInlineSize="90px">
            <s-number-field
              min={1}
              step={1}
              value={getQtyValue(variant)}
              disabled={disabled}
              onChange={(e) =>
                onQtyChange(variant, e.currentTarget?.value ?? e.target?.value)
              }
            />
          </s-stack>
        </s-table-cell>
      )}

      {/* 5. Disabled Regular Price */}
      <s-table-cell>
        <s-stack maxInlineSize="160px">
          <s-money-field value={variant.price} disabled />
        </s-stack>
      </s-table-cell>
    </s-table-row>
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const tierId = url.searchParams.get("id");
  const after = url.searchParams.get("after") || null;

  const response = await admin.graphql(
    `#graphql
      query GetPricingData($after: String) {
        shop { currencyCode }
        metafieldDefinitions(first: 100, namespace: "$app", ownerType: PRODUCTVARIANT) {
          nodes { id key name type { name } }
        }
        products(first: 50, after: $after) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          nodes {
            id title
            media(first: 1) { nodes { preview { image { url } } } }
            priceRangeV2 {
              maxVariantPrice { amount }
              minVariantPrice { amount }
            }
            variantsCount { count }
            variants(first: 100) {
              nodes {
                id title price
                metafields(namespace: "$app", first: 100) {
                  nodes { id key type value }
                }
              }
              pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
            }
          }
        }
      }
    `,
    { variables: { after } }
  );

  const data = await response.json();
  const defs = data?.data?.metafieldDefinitions?.nodes ?? [];
  const tierGid = `gid://shopify/MetafieldDefinition/${tierId}`;
  const tierDef = defs.find((d) => d.id === tierGid) ?? null;
  const priceKey = tierDef?.key ?? null;
  const qtyKey = priceKey ? `${priceKey}_min` : null;
  const qtyDef = qtyKey ? (defs.find((d) => d.key === qtyKey) ?? null) : null;

  return {
    tierId,
    tierDef,
    priceKey,
    qtyKey: qtyDef ? qtyKey : null,
    currencyCode: data?.data?.shop?.currencyCode ?? "USD",
    products: data?.data?.products?.nodes ?? [],
    pageInfo: data?.data?.products?.pageInfo ?? {},
  };
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  // Fetch paginated products
  if (intent === "fetchProducts") {
    const after = formData.get("after") || null;
    const prodResponse = await admin.graphql(
      `#graphql
        query GetPagedProducts($after: String) {
          products(first: 50, after: $after) {
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
            nodes {
              id title
              media(first: 1) { nodes { preview { image { url } } } }
              priceRangeV2 {
                maxVariantPrice { amount }
                minVariantPrice { amount }
              }
              variantsCount { count }
              variants(first: 100) {
                nodes {
                  id title price
                  metafields(namespace: "$app", first: 100) {
                    nodes { id key type value }
                  }
                }
                pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
              }
            }
          }
        }
      `,
      { variables: { after } }
    );
    const prodData = await prodResponse.json();
    if (prodData.errors?.length) {
      return {
        intent: "fetchProducts",
        ok: false,
        error: prodData.errors.map((e) => e.message).join(", "),
        products: [],
        pageInfo: {},
      };
    }
    return {
      intent: "fetchProducts",
      ok: true,
      products: prodData?.data?.products?.nodes ?? [],
      pageInfo: prodData?.data?.products?.pageInfo ?? {},
    };
  }

  // Fetch paginated variants for an expanded product
  if (intent === "fetchVariants") {
    const productId = formData.get("productId");
    const after = formData.get("after") || null;
    const varResponse = await admin.graphql(
      `#graphql
        query GetProductVariants($productId: ID!, $after: String) {
          product(id: $productId) {
            variants(first: 100, after: $after) {
              nodes {
                id title price
                metafields(namespace: "$app", first: 100) {
                  nodes { id key type value }
                }
              }
              pageInfo { endCursor hasNextPage hasPreviousPage startCursor }
            }
          }
        }
      `,
      { variables: { productId, after } }
    );
    const varData = await varResponse.json();
    if (varData.errors?.length) {
      return {
        intent: "fetchVariants",
        ok: false,
        error: varData.errors.map((e) => e.message).join(", "),
        productId,
        variants: [],
        pageInfo: {},
      };
    }
    return {
      intent: "fetchVariants",
      ok: true,
      productId,
      variants: varData?.data?.product?.variants?.nodes ?? [],
      pageInfo: varData?.data?.product?.variants?.pageInfo ?? {},
    };
  }

  // Save metafields in batches of 250 (Shopify official limit per mutation call)
  if (intent === "save") {
    const metafieldsRaw = formData.get("metafields");
    let metafields = [];
    try {
      metafields = JSON.parse(metafieldsRaw);
    } catch {
      return { intent: "save", ok: false, error: "Invalid metafields payload." };
    }
    if (!Array.isArray(metafields) || metafields.length === 0) {
      return { intent: "save", ok: true, saved: 0 };
    }
    const chunks = chunkArray(metafields, 250);
    const allSaved = [];
    const allErrors = [];
    for (const chunk of chunks) {
      const mutResponse = await admin.graphql(
        `#graphql
          mutation SaveMetafields($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key type value owner { ... on ProductVariant { id } } }
              userErrors { field message code }
            }
          }
        `,
        { variables: { metafields: chunk } }
      );
      const mutData = await mutResponse.json();
      if (mutData.errors?.length) {
        allErrors.push(...mutData.errors.map((e) => e.message));
      }
      const payload = mutData?.data?.metafieldsSet;
      if (payload?.userErrors?.length) {
        allErrors.push(...payload.userErrors.map((e) => e.message));
      }
      if (payload?.metafields?.length) {
        allSaved.push(...payload.metafields);
      }
    }
    if (allErrors.length) {
      return { intent: "save", ok: false, error: allErrors.join("; "), saved: allSaved.length };
    }
    return { intent: "save", ok: true, saved: allSaved.length };
  }

  return { ok: false, error: "Unknown intent." };
};

// ─── Should Revalidate ────────────────────────────────────────────────────────

export function shouldRevalidate(arg) {
  const intent = arg.formData?.get("intent") || arg.actionResult?.intent;
  if (intent === "fetchProducts" || intent === "fetchVariants" || intent === "save") {
    return false;
  }
  return arg.defaultShouldRevalidate;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Pricing() {
  const loaderData = useLoaderData();
  const { tierDef, priceKey, qtyKey, currencyCode } = loaderData;
  const fetcher = useFetcher();

  // Products and product pagination state
  const [products, setProducts] = useState(loaderData.products ?? []);
  const [productPageInfo, setProductPageInfo] = useState(loaderData.pageInfo ?? {});
  const [productCursorHistory, setProductCursorHistory] = useState([null]);
  const [productPageLoading, setProductPageLoading] = useState(false);

  // Edit state: compositeKey → { value, originalValue, type, key, ownerId }
  const [edits, setEdits] = useState(() =>
    mergeVariantsIntoEdits({}, loaderData.products ?? [], priceKey, qtyKey)
  );

  // Expanded products: productId → { variants, pageInfo, cursorHistory, pageLoading }
  const [expandedProducts, setExpandedProducts] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const pendingFetchRef = useRef(null);
  const pendingSaveRef = useRef(false);
  const pendingProductFetchRef = useRef(null);

  // ── Sync loader updates on tier change ───────────────────────────────────

  const currentTierIdRef = useRef(loaderData.tierId);
  useEffect(() => {
    if (currentTierIdRef.current !== loaderData.tierId) {
      currentTierIdRef.current = loaderData.tierId;
      setProducts(loaderData.products ?? []);
      setProductPageInfo(loaderData.pageInfo ?? {});
      setProductCursorHistory([null]);
      setExpandedProducts({});
      setEdits(mergeVariantsIntoEdits({}, loaderData.products ?? [], priceKey, qtyKey));
    }
  }, [loaderData.tierId, loaderData.products, loaderData.pageInfo, priceKey, qtyKey]);

  // ── Handle fetcher responses ─────────────────────────────────────────────

  useEffect(() => {
    if (!fetcher.data) return;

    // Handle product-level pagination responses
    if (fetcher.data.intent === "fetchProducts") {
      setProductPageLoading(false);
      const pending = pendingProductFetchRef.current;
      pendingProductFetchRef.current = null;
      if (fetcher.data.ok === false) {
        setSaveError(fetcher.data.error || "Failed to load products.");
        return;
      }
      const newProducts = fetcher.data.products ?? [];
      const newPageInfo = fetcher.data.pageInfo ?? {};
      setProducts(newProducts);
      setProductPageInfo(newPageInfo);

      if (pending?.direction === "next") {
        setProductCursorHistory((prev) => [...prev, pending.cursor]);
      } else if (pending?.direction === "prev") {
        setProductCursorHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }

      // Merge new products into edits (preserving already-edited values)
      setEdits((prevEdits) =>
        mergeVariantsIntoEdits(prevEdits, newProducts, priceKey, qtyKey)
      );
    }

    // Handle variant-level pagination responses for an expanded product
    if (fetcher.data.intent === "fetchVariants") {
      const pid = fetcher.data.productId;
      if (pendingFetchRef.current?.productId !== pid) return;
      const direction = pendingFetchRef.current.direction;
      pendingFetchRef.current = null;

      if (fetcher.data.ok === false) {
        setSaveError(fetcher.data.error || "Failed to load variants.");
        setExpandedProducts((prev) => ({
          ...prev,
          [pid]: { ...(prev[pid] ?? {}), pageLoading: false },
        }));
        return;
      }

      const newVariants = fetcher.data.variants ?? [];
      const newPageInfo = fetcher.data.pageInfo ?? {};

      setExpandedProducts((prev) => {
        const current = prev[pid] ?? { cursorHistory: [null] };
        let newHistory = [...(current.cursorHistory ?? [null])];
        if (direction === "next") {
          newHistory.push(newPageInfo.startCursor ?? null);
        } else if (direction === "prev") {
          newHistory.pop();
        }
        return {
          ...prev,
          [pid]: {
            variants: newVariants,
            pageInfo: newPageInfo,
            cursorHistory: newHistory,
            pageLoading: false,
          },
        };
      });

      // Merge new variants into edits without overwriting existing edits
      setEdits((prevEdits) => {
        const nextEdits = { ...prevEdits };
        for (const v of newVariants) {
          if (priceKey) {
            const pk = editKey(v.id, priceKey);
            if (!(pk in nextEdits)) {
              const mf = v.metafields?.nodes?.find((m) => m.key === priceKey);
              const orig = mf ? (parseMoneyAmount(mf.value) ?? v.price) : v.price;
              nextEdits[pk] = { value: orig, originalValue: orig, type: "money", key: priceKey, ownerId: v.id };
            }
          }
          if (qtyKey) {
            const qk = editKey(v.id, qtyKey);
            if (!(qk in nextEdits)) {
              const mfQ = v.metafields?.nodes?.find((m) => m.key === qtyKey);
              const origQ = mfQ?.value ?? "1";
              nextEdits[qk] = { value: origQ, originalValue: origQ, type: "number_integer", key: qtyKey, ownerId: v.id };
            }
          }
        }
        return nextEdits;
      });
    }

    // Handle save response
    if (fetcher.data.intent === "save" && pendingSaveRef.current) {
      pendingSaveRef.current = false;
      setSaving(false);
      if (fetcher.data.ok) {
        setSaveSuccess(true);
        // Commit: current values become the new baseline original values
        setEdits((prev) => {
          const next = {};
          for (const [k, entry] of Object.entries(prev)) {
            next[k] = { ...entry, originalValue: entry.value };
          }
          return next;
        });
      } else {
        setSaveError(fetcher.data.error ?? "Save failed.");
      }
    }
  }, [fetcher.data, priceKey, qtyKey]);

  // ── No tier found guard ──────────────────────────────────────────────────

  if (!tierDef || !priceKey) {
    return (
      <s-page heading="B2B Pricing">
        <s-section>
          <s-banner tone="critical">
            Pricing tier not found. Please go back to Tier Pricings and select a valid tier.
          </s-banner>
        </s-section>
      </s-page>
    );
  }

  // ── Value getters ────────────────────────────────────────────────────────

  const getPriceValue = (variant) => {
    if (!variant) return "0.00";
    const k = editKey(variant.id, priceKey);
    if (k in edits) return edits[k].value ?? variant.price;
    const mf = variant.metafields?.nodes?.find((m) => m.key === priceKey);
    return mf ? (parseMoneyAmount(mf.value) ?? variant.price) : variant.price;
  };

  const getQtyValue = (variant) => {
    if (!qtyKey || !variant) return "1";
    const k = editKey(variant.id, qtyKey);
    if (k in edits) return edits[k].value ?? "1";
    const mf = variant.metafields?.nodes?.find((m) => m.key === qtyKey);
    return mf?.value ?? "1";
  };

  // ── Edit handlers ────────────────────────────────────────────────────────

  const handlePriceChange = (variant, newValue) => {
    const k = editKey(variant.id, priceKey);
    setEdits((prev) => {
      const existing = prev[k];
      const mf = variant.metafields?.nodes?.find((m) => m.key === priceKey);
      const orig = existing?.originalValue ?? (mf ? (parseMoneyAmount(mf?.value) ?? variant.price) : variant.price);
      return {
        ...prev,
        [k]: { value: newValue, originalValue: orig, type: "money", key: priceKey, ownerId: variant.id },
      };
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleQtyChange = (variant, newValue) => {
    if (!qtyKey) return;
    const k = editKey(variant.id, qtyKey);
    setEdits((prev) => {
      const existing = prev[k];
      const mf = variant.metafields?.nodes?.find((m) => m.key === qtyKey);
      const orig = existing?.originalValue ?? (mf?.value ?? "1");
      return {
        ...prev,
        [k]: {
          value: newValue === "" ? "1" : String(newValue),
          originalValue: orig,
          type: "number_integer",
          key: qtyKey,
          ownerId: variant.id,
        },
      };
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  // ── Product-level Pagination ─────────────────────────────────────────────

  const loadProductPage = (cursor, direction) => {
    setProductPageLoading(true);
    setSaveError(null);
    setSaveSuccess(false);
    pendingProductFetchRef.current = { cursor, direction };
    const fd = new FormData();
    fd.append("intent", "fetchProducts");
    if (cursor) {
      fd.append("after", cursor);
    }
    fetcher.submit(fd, { method: "POST" });
  };

  const handleNextProductPage = () => {
    if (!productPageInfo?.hasNextPage || productPageLoading || saving) return;
    const nextCursor = productPageInfo.endCursor;
    loadProductPage(nextCursor, "next");
  };

  const handlePrevProductPage = () => {
    if (productCursorHistory.length <= 1 || productPageLoading || saving) return;
    const prevCursor = productCursorHistory[productCursorHistory.length - 2];
    loadProductPage(prevCursor, "prev");
  };

  // ── Variant-level Expansion & Pagination ──────────────────────────────────

  const toggleVariants = (product) => {
    const pid = product.id;
    if (expandedProducts[pid]) {
      setExpandedProducts((prev) => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      return;
    }
    setExpandedProducts((prev) => ({
      ...prev,
      [pid]: {
        variants: product.variants?.nodes ?? [],
        pageInfo: product.variants?.pageInfo ?? {},
        cursorHistory: [null],
        pageLoading: false,
      },
    }));
  };

  const loadVariantPage = (productId, afterCursor, direction) => {
    setExpandedProducts((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], pageLoading: true },
    }));
    pendingFetchRef.current = { productId, direction };
    const fd = new FormData();
    fd.append("intent", "fetchVariants");
    fd.append("productId", productId);
    if (afterCursor) fd.append("after", afterCursor);
    fetcher.submit(fd, { method: "POST" });
  };

  const handleNextVariantPage = (productId) => {
    const state = expandedProducts[productId];
    if (!state || !state.pageInfo?.hasNextPage) return;
    loadVariantPage(productId, state.pageInfo.endCursor, "next");
  };

  const handlePrevVariantPage = (productId) => {
    const state = expandedProducts[productId];
    if (!state || (state.cursorHistory?.length ?? 0) <= 1) return;
    const prevCursor = state.cursorHistory[state.cursorHistory.length - 2];
    loadVariantPage(productId, prevCursor, "prev");
  };

  // ── Cancel ───────────────────────────────────────────────────────────────

  const handleCancel = () => {
    setEdits((prev) => {
      const reset = {};
      for (const [k, entry] of Object.entries(prev)) {
        reset[k] = { ...entry, value: entry.originalValue };
      }
      return reset;
    });
    setSaveError(null);
    setSaveSuccess(false);
  };

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (saving) return;
    setSaveError(null);
    setSaveSuccess(false);

    const metafieldsToSave = [];
    for (const [, entry] of Object.entries(edits)) {
      if (String(entry.value ?? "") === String(entry.originalValue ?? "")) continue;
      let serialized;
      if (entry.type === "money") {
        const amount = String(entry.value ?? "").trim();
        if (!amount) continue;
        const n = Number(amount);
        if (!Number.isFinite(n) || n < 0) {
          setSaveError(`Invalid price: ${amount}`);
          return;
        }
        serialized = JSON.stringify({ amount, currency_code: currencyCode });
      } else if (entry.type === "number_integer") {
        const n = Number(entry.value);
        if (!Number.isInteger(n) || n < 1) {
          setSaveError("Min quantity must be a whole number ≥ 1.");
          return;
        }
        serialized = String(n);
      } else {
        serialized = String(entry.value ?? "");
      }
      metafieldsToSave.push({
        key: entry.key,
        ownerId: entry.ownerId,
        type: entry.type,
        namespace: "$app",
        value: serialized,
      });
    }

    if (metafieldsToSave.length === 0) {
      setSaveSuccess(true);
      return;
    }

    setSaving(true);
    pendingSaveRef.current = true;
    const fd = new FormData();
    fd.append("intent", "save");
    fd.append("metafields", JSON.stringify(metafieldsToSave));
    fetcher.submit(fd, { method: "POST" });
  };

  const hasChanges = Object.values(edits).some(
    (e) => String(e.value ?? "") !== String(e.originalValue ?? "")
  );

  // ── Sync shopify.saveBar with dirty state (hasChanges) ───────────────────

  const saveBarId = "pricing-save-bar";

  useEffect(() => {
    if (typeof shopify !== "undefined" && shopify.saveBar) {
      if (hasChanges) {
        shopify.saveBar.show(saveBarId);
      } else {
        shopify.saveBar.hide(saveBarId);
      }
    }
  }, [hasChanges]);

  // Hide save bar on component unmount
  useEffect(() => {
    return () => {
      if (typeof shopify !== "undefined" && shopify.saveBar) {
        shopify.saveBar.hide(saveBarId);
      }
    };
  }, []);

  // show toast
    if(saveSuccess) shopify.toast.show('Saved Successfully');

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <s-page heading={`${tierDef.name} — B2B Pricing`}>
      <ui-save-bar id={saveBarId}>
        <button
          variant="primary"
          onClick={handleSave}
          disabled={saving || productPageLoading}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleCancel}
          disabled={saving || productPageLoading}
        >
          Discard
        </button>
      </ui-save-bar>

      {saveError && <s-banner tone="critical">{saveError}</s-banner>}
      {saveSuccess && <s-banner tone="success">Pricing saved successfully!</s-banner>}
      <s-section>

        <s-table>
          <s-table-header-row>
            <s-table-header></s-table-header>
            <s-table-header>Product / Variant</s-table-header>
            <s-table-header>{tierDef.name} ({currencyCode})</s-table-header>
            {qtyKey && <s-table-header>Min Qty</s-table-header>}
            <s-table-header>Regular Price</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {products.length === 0 ? (
              <s-table-row>
                <s-table-cell colSpan={qtyKey ? 5 : 4}>
                  <s-box padding="base">
                    <s-text tone="subdued">No products found.</s-text>
                  </s-box>
                </s-table-cell>
              </s-table-row>
            ) : (
              products.map((product) => {
                const expanded = expandedProducts[product.id];

                return (
                  <Fragment key={product.id}>
                    {/* Component for Product 5-column row */}
                    <ProductRow
                      product={product}
                      qtyKey={qtyKey}
                      isExpanded={Boolean(expanded)}
                      onToggleExpand={toggleVariants}
                      getPriceValue={getPriceValue}
                      getQtyValue={getQtyValue}
                      onPriceChange={handlePriceChange}
                      onQtyChange={handleQtyChange}
                      disabled={saving || productPageLoading}
                    />

                    {/* Expanded variant sub-rows */}
                    {expanded && (
                      <>
                        {expanded.pageLoading ? (
                          <s-table-row key={`${product.id}-loading`}>
                            <s-table-cell colSpan={qtyKey ? 5 : 4}>
                              <s-stack direction="inline" gap="small" alignItems="center" padding="small">
                                <s-spinner size="small" />
                                <s-text tone="subdued">Loading variants...</s-text>
                              </s-stack>
                            </s-table-cell>
                          </s-table-row>
                        ) : (
                          expanded.variants.map((variant) => (
                            /* Component for Variant 5-column row */
                            <VariantRow
                              key={variant.id}
                              variant={variant}
                              qtyKey={qtyKey}
                              getPriceValue={getPriceValue}
                              getQtyValue={getQtyValue}
                              onPriceChange={handlePriceChange}
                              onQtyChange={handleQtyChange}
                              disabled={saving || productPageLoading}
                            />
                          ))
                        )}

                        {/* Variant pagination */}
                        {((expanded.pageInfo?.hasNextPage) || (expanded.cursorHistory?.length ?? 0) > 1) && (
                          <s-table-row key={`${product.id}-pagination`}>
                            <s-table-cell colSpan={qtyKey ? 5 : 4}>
                              <s-stack direction="inline" gap="base" justifyContent="center" alignItems="center" padding="small">
                                <s-button
                                  variant="tertiary"
                                  disabled={(expanded.cursorHistory?.length ?? 0) <= 1 || expanded.pageLoading}
                                  onClick={() => handlePrevVariantPage(product.id)}
                                >
                                  ← Previous Variants
                                </s-button>
                                <s-text tone="subdued">
                                  Variant Page {expanded.cursorHistory?.length ?? 1}
                                </s-text>
                                <s-button
                                  variant="tertiary"
                                  disabled={!expanded.pageInfo?.hasNextPage || expanded.pageLoading}
                                  onClick={() => handleNextVariantPage(product.id)}
                                >
                                  Next Variants →
                                </s-button>
                              </s-stack>
                            </s-table-cell>
                          </s-table-row>
                        )}
                      </>
                    )}
                  </Fragment>
                );
              })
            )}
          </s-table-body>
        </s-table>

        {/* Product Pagination Bar */}
        <s-stack
          direction="inline"
          gap="base"
          justifyContent="space-between"
          alignItems="center"
          paddingBlockStart="base"
        >
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text tone="subdued">
              Product Page {productCursorHistory.length}
            </s-text>
            {productPageLoading && (
              <s-stack direction="inline" gap="small" alignItems="center">
                <s-spinner size="small" />
                <s-text tone="subdued">Loading products...</s-text>
              </s-stack>
            )}
          </s-stack>

          <s-stack direction="inline" gap="small" alignItems="center">
            <s-button
              variant="secondary"
              disabled={productCursorHistory.length <= 1 || productPageLoading || saving}
              onClick={handlePrevProductPage}
            >
              ← Previous Products
            </s-button>
            <s-button
              variant="secondary"
              disabled={!productPageInfo?.hasNextPage || productPageLoading || saving}
              onClick={handleNextProductPage}
            >
              Next Products →
            </s-button>
          </s-stack>
        </s-stack>

      </s-section>
        {hasChanges && (
          <s-stack direction="inline" gap="base" justifyContent="end" alignItems="center" paddingBlockStart="base">
            <s-button variant="secondary" onClick={handleCancel} disabled={saving || productPageLoading}>
              Cancel
            </s-button>
            <s-button
              variant="primary"
              onClick={handleSave}
              disabled={saving || productPageLoading}
              {...(saving ? { loading: true } : {})}
            >
              {saving ? "Saving..." : "Save"}
            </s-button>
          </s-stack>
        )}
    </s-page>
  );
}