import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw Shopify metafield value string into a JS value.
 *   money          -> { amount: "10.00", currency_code: "CAD" }
 *   number_integer -> integer
 *   number_decimal -> float
 *   everything else -> raw string
 */
function parseMetafieldValue(type, rawValue) {
  if (rawValue == null) return null;
  try {
    if (type === "money") return JSON.parse(rawValue);
    if (type === "number_integer") return parseInt(rawValue, 10);
    if (type === "number_decimal") return parseFloat(rawValue);
    return rawValue;
  } catch {
    return rawValue;
  }
}

/**
 * Build tier descriptors from definition edges.
 * Convention: a key ending in "_pricing" is a price field;
 * the same key + "_min" is its quantity companion.
 * Returns [{ label, priceKey, priceType, qtyKey, qtyType }, ...]
 */
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
        priceType: defMap[key].type,
        qtyKey: defMap[qtyKey] ? qtyKey : null,
        qtyType: defMap[qtyKey]?.type ?? "number_integer",
      });
    }
  }
  return tiers;
}

/**
 * Composite edit map key: "${variantId}::${metafieldKey}"
 */
function editKey(variantId, mfKey) {
  return `${variantId}::${mfKey}`;
}

/**
 * Split array into chunks of at most `size` items.
 */
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * For each variant in variantNodes, initialize edit entries for every
 * definition key — but ONLY if the entry doesn't exist yet (preserve
 * existing user edits when paginating back to a page).
 */
function mergeVariantsIntoEdits(editsMap, variantNodes, definitionEdges) {
  for (const variant of variantNodes) {
    const mfByKey = {};
    for (const { node } of (variant.metafields?.edges ?? [])) {
      mfByKey[node.key] = node;
    }
    for (const { node: def } of definitionEdges) {
      const k = editKey(variant.id, def.key);
      if (k in editsMap) continue; // preserve existing user edits
      const mf = mfByKey[def.key];
      const parsed = mf ? parseMetafieldValue(def.type.name, mf.value) : null;
      let editableValue = null;
      if (parsed != null) {
        editableValue = def.type.name === "money"
          ? (parsed.amount ?? null)
          : String(parsed);
      }
      editsMap[k] = {
        id: mf?.id ?? null,
        type: def.type.name,
        value: editableValue,
        existingCurrencyCode:
          def.type.name === "money" && parsed?.currency_code
            ? parsed.currency_code
            : null,
      };
    }
  }
}

/**
 * Shallow-clone the edits map (each entry is spread).
 */
function deepCloneEdits(edits) {
  const clone = {};
  for (const [k, v] of Object.entries(edits)) {
    clone[k] = { ...v };
  }
  return clone;
}

/**
 * Serialize a UI value back into the string format Shopify expects
 * in metafieldsSet.value.
 */
function serializeMetafieldValue(type, value, currencyCode, existingCurrencyCode) {
  if (type === "money") {
    const amount = String(value ?? "").trim();
    if (!amount) throw new Error("Price cannot be empty.");
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid price: ${amount}`);
    return JSON.stringify({
      amount,
      currency_code: existingCurrencyCode || currencyCode || "USD",
    });
  }
  if (type === "number_integer") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1)
      throw new Error("Min quantity must be a whole number of at least 1.");
    return String(n);
  }
  if (type === "number_decimal") {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("Invalid decimal value.");
    return String(n);
  }
  return String(value ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

function Extension() {
  const { close, data } = shopify;
  const productId = data.selected[0].id;

  // ── Loading / status ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // ── Product / shop metadata ───────────────────────────────────────────────
  const [productTitle, setProductTitle] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");

  // ── Tier selection ────────────────────────────────────────────────────────
  const [definitionEdges, setDefinitionEdges] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [selectedTier, setSelectedTier] = useState(null);

  // ── Variant pagination ────────────────────────────────────────────────────
  // cursorHistory: ordered list of afterCursor values used to reach each page.
  //   [null]                     → on page 1 (loaded with after=null)
  //   [null, "cursor_50"]        → on page 2
  //   [null, "cursor_50", "cursor_100"] → on page 3
  // To go back: pop last item, use new last item as afterCursor.
  const [variants, setVariants] = useState([]);
  const [pageInfo, setPageInfo] = useState({
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: null,
    endCursor: null,
  });
  const [cursorHistory, setCursorHistory] = useState([null]);

  // ── Edit state ────────────────────────────────────────────────────────────
  // Key: "${variantId}::${mfKey}" → { id, type, value, existingCurrencyCode }
  // Persists across page navigations.
  const [variantEdits, setVariantEdits] = useState({});
  const [initialVariantEdits, setInitialVariantEdits] = useState({});

  // ─────────────────────────────────────────────────────────────────────────
  // Data loading
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("shopify:admin/api/graphql.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query WholesaleActionInit($productId: ID!, $first: Int!) {
              shop {
                currencyCode
              }
              metafieldDefinitions(
                first: 100
                namespace: "$app"
                ownerType: PRODUCTVARIANT
              ) {
                edges {
                  node {
                    id
                    key
                    name
                    type {
                      name
                    }
                  }
                }
              }
              product(id: $productId) {
                title
                variants(first: $first) {
                  nodes {
                    id
                    title
                    price
                    metafields(namespace: "$app", first: 100) {
                      edges {
                        node {
                          id
                          key
                          type
                          value
                        }
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                }
              }
            }
          `,
          variables: { productId, first: PAGE_SIZE },
        }),
      });

      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const json = await response.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);

      const respData = json.data;
      if (!respData) throw new Error("Shopify returned no data.");
      if (!respData.product) throw new Error("Product not found.");

      const defEdges = respData.metafieldDefinitions?.edges ?? [];
      const discoveredTiers = buildTiersFromDefinitions(defEdges);
      const variantNodes = respData.product.variants?.nodes ?? [];
      const pi = respData.product.variants?.pageInfo ?? {};

      setDefinitionEdges(defEdges);
      setTiers(discoveredTiers);
      setSelectedTier(discoveredTiers[0] ?? null);
      setProductTitle(respData.product.title ?? "");
      setCurrencyCode(respData.shop?.currencyCode ?? "USD");
      setVariants(variantNodes);
      setPageInfo({
        hasNextPage: pi.hasNextPage ?? false,
        hasPreviousPage: false,
        startCursor: pi.startCursor ?? null,
        endCursor: pi.endCursor ?? null,
      });
      setCursorHistory([null]);

      const initialEdits = {};
      mergeVariantsIntoEdits(initialEdits, variantNodes, defEdges);
      setVariantEdits(deepCloneEdits(initialEdits));
      setInitialVariantEdits(deepCloneEdits(initialEdits));

    } catch (err) {
      console.error("Action init error:", err);
      setError(err?.message ?? "Failed to load product data.");
    } finally {
      setLoading(false);
    }
  };

  const loadVariantPage = async (afterCursor) => {
    setPageLoading(true);
    setError(null);
    try {
      const response = await fetch("shopify:admin/api/graphql.json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query WholesaleVariantPage($productId: ID!, $first: Int!, $after: String) {
              product(id: $productId) {
                variants(first: $first, after: $after) {
                  nodes {
                    id
                    title
                    price
                    metafields(namespace: "$app", first: 100) {
                      edges {
                        node {
                          id
                          key
                          type
                          value
                        }
                      }
                    }
                  }
                  pageInfo {
                    hasNextPage
                    hasPreviousPage
                    startCursor
                    endCursor
                  }
                }
              }
            }
          `,
          variables: { productId, first: PAGE_SIZE, after: afterCursor },
        }),
      });

      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      const json = await response.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);

      const variantsData = json.data?.product?.variants;
      if (!variantsData) throw new Error("Variants data not found.");

      const variantNodes = variantsData.nodes ?? [];
      const pi = variantsData.pageInfo ?? {};

      setVariants(variantNodes);
      setPageInfo({
        hasNextPage: pi.hasNextPage ?? false,
        hasPreviousPage: pi.hasPreviousPage ?? false,
        startCursor: pi.startCursor ?? null,
        endCursor: pi.endCursor ?? null,
      });

      // Merge saved values for newly seen variants into both initial and active edits
      setInitialVariantEdits((prev) => {
        const next = { ...prev };
        mergeVariantsIntoEdits(next, variantNodes, definitionEdges);
        return next;
      });

      setVariantEdits((prev) => {
        const next = { ...prev };
        mergeVariantsIntoEdits(next, variantNodes, definitionEdges);
        return next;
      });

    } catch (err) {
      console.error("Page load error:", err);
      setError(err?.message ?? "Failed to load variants.");
    } finally {
      setPageLoading(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Pagination
  // ─────────────────────────────────────────────────────────────────────────

  const handleNextPage = () => {
    const newHistory = [...cursorHistory, pageInfo.endCursor];
    setCursorHistory(newHistory);
    loadVariantPage(pageInfo.endCursor);
  };

  const handlePrevPage = () => {
    const newHistory = [...cursorHistory];
    newHistory.pop();
    const prevCursor = newHistory[newHistory.length - 1];
    setCursorHistory(newHistory);
    loadVariantPage(prevCursor);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Field change handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleTierChange = (priceKey) => {
    const tier = tiers.find((t) => t.priceKey === priceKey) ?? null;
    setSelectedTier(tier);
  };

  const handlePriceChange = (variantId, priceKey, newValue) => {
    const k = editKey(variantId, priceKey);
    setVariantEdits((prev) => ({
      ...prev,
      [k]: { ...prev[k], value: newValue },
    }));
    setError(null);
  };

  const handleQtyChange = (variantId, qtyKey, newValue) => {
    const k = editKey(variantId, qtyKey);
    setVariantEdits((prev) => ({
      ...prev,
      [k]: {
        ...prev[k],
        value: newValue === "" || newValue == null ? "" : String(newValue),
      },
    }));
    setError(null);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Cancel
  // ─────────────────────────────────────────────────────────────────────────

  const handleCancel = () => {
    setVariantEdits(deepCloneEdits(initialVariantEdits));
    setError(null);
    close();
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Save — collect all changed metafields, chunk by 25, send sequentially
  // ─────────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const changedMetafields = [];

      for (const [compositeKey, current] of Object.entries(variantEdits)) {
        const initial = initialVariantEdits[compositeKey];
        const currentValue = current?.value ?? null;
        const initialValue = initial?.value ?? null;

        // Skip unchanged values
        if (String(currentValue ?? "") === String(initialValue ?? "")) continue;

        const [variantId, mfKey] = compositeKey.split("::");
        const type = current?.type ?? initial?.type;
        if (!type || !variantId || !mfKey) continue;

        const rawValue = current?.value ?? "";

        // Validate integer quantity
        if (type === "number_integer") {
          const n = Number(rawValue);
          if (!Number.isInteger(n) || n < 1) {
            throw new Error("Min quantity must be a whole number of at least 1.");
          }
        }

        // Validate decimal
        if (type === "number_decimal") {
          const n = Number(rawValue);
          if (!Number.isFinite(n)) throw new Error("Invalid decimal value.");
        }

        const existingCurrencyCode =
          current?.existingCurrencyCode ?? initial?.existingCurrencyCode ?? null;

        const serializedValue = serializeMetafieldValue(
          type,
          rawValue,
          currencyCode,
          existingCurrencyCode,
        );

        changedMetafields.push({
          key: mfKey,
          ownerId: variantId,
          type,
          value: serializedValue,
        });
      }

      if (changedMetafields.length === 0) {
        close();
        return;
      }

      // Send in chunks of 25 (Shopify's metafieldsSet limit)
      const chunks = chunkArray(changedMetafields, 25);
      const allSaved = [];

      for (const chunk of chunks) {
        const response = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
              mutation SetVariantMetafields($metafields: [MetafieldsSetInput!]!) {
                metafieldsSet(metafields: $metafields) {
                  metafields {
                    id
                    key
                    owner {
                      ... on ProductVariant {
                        id
                      }
                    }
                    type
                    value
                  }
                  userErrors {
                    field
                    message
                    code
                  }
                }
              }
            `,
            variables: { metafields: chunk },
          }),
        });

        if (!response.ok) throw new Error(`Save request failed: ${response.status}`);
        const json = await response.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);

        const payload = json.data?.metafieldsSet;
        if (!payload) throw new Error("Shopify did not return a metafieldsSet response.");
        if (payload.userErrors?.length) {
          throw new Error(payload.userErrors.map((e) => e.message).join(", "));
        }

        allSaved.push(...(payload.metafields ?? []));
      }

      console.log("Wholesale pricing saved:", allSaved.length, "metafields");

      // Update initial snapshot so re-editing shows correct diff
      const newInitial = deepCloneEdits(variantEdits);
      for (const saved of allSaved) {
        const variantId = saved.owner?.id;
        if (!variantId) continue;
        const k = editKey(variantId, saved.key);
        if (newInitial[k]) {
          const parsed = parseMetafieldValue(saved.type, saved.value);
          newInitial[k].id = saved.id;
          newInitial[k].value =
            saved.type === "money"
              ? (parsed?.amount ?? null)
              : parsed != null ? String(parsed) : null;
          if (saved.type === "money") {
            newInitial[k].existingCurrencyCode = parsed?.currency_code ?? null;
          }
        }
      }
      setInitialVariantEdits(newInitial);

      // Update IDs in variantEdits for newly created metafields
      setVariantEdits((prev) => {
        const next = { ...prev };
        for (const saved of allSaved) {
          const variantId = saved.owner?.id;
          if (!variantId) continue;
          const k = editKey(variantId, saved.key);
          if (next[k]) next[k] = { ...next[k], id: saved.id };
        }
        return next;
      });

      close();

    } catch (err) {
      console.error("Save error:", err);
      setError(err?.message ?? "Failed to save pricing.");
    } finally {
      setSaving(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const currentPage = cursorHistory.length;
  const canGoPrev = cursorHistory.length > 1;
  const canGoNext = pageInfo.hasNextPage;
  const hasMultiplePages = canGoPrev || canGoNext;
  const gridColumns = selectedTier?.qtyKey ? "2fr 2fr 1fr" : "2fr 2fr";

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <s-admin-action heading="Set Wholesale Pricing">
      <s-stack direction="block" gap="base">

        {productTitle ? (
          <s-text tone="subdued">{productTitle}</s-text>
        ) : null}

        {error ? (
          <s-banner tone="critical">{error}</s-banner>
        ) : null}

        {saving ? (
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-spinner />
            <s-text tone="subdued">Saving...</s-text>
          </s-stack>
        ) : null}

        {loading ? (
          <s-spinner />
        ) : tiers.length === 0 ? (
          <s-banner tone="info">
            No pricing tiers defined. Add variant metafield definitions to your app configuration.
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">

            <s-select
              label="Pricing Tier"
              name="tier"
              value={selectedTier?.priceKey ?? ""}
              disabled={pageLoading || saving}
              onChange={(e) =>
                handleTierChange(e.currentTarget?.value || e.target?.value)
              }
            >
              {tiers.map(({ label, priceKey }) => (
                <s-option key={priceKey} value={priceKey}>{label}</s-option>
              ))}
            </s-select>

            {selectedTier ? (
              <s-stack direction="block" gap="small">

                {/* Column header row */}
                <s-grid gridTemplateColumns={gridColumns} gap="small" alignItems="end">
                  <s-text type="strong">Variant</s-text>
                  <s-text type="strong">{selectedTier.label}</s-text>
                  {selectedTier.qtyKey ? <s-text type="strong">Min Qty</s-text> : null}
                </s-grid>

                {pageLoading ? (
                  <s-spinner />
                ) : variants.length === 0 ? (
                  <s-text tone="subdued">No variants found for this product.</s-text>
                ) : (
                  <s-stack direction="block" gap="small-500">
                    {variants.map((variant) => {
                      const priceEdit = variantEdits[editKey(variant.id, selectedTier.priceKey)];
                      const qtyEdit = selectedTier.qtyKey
                        ? variantEdits[editKey(variant.id, selectedTier.qtyKey)]
                        : null;

                      // Price: edited value → saved metafield value → variant default price
                      const priceValue =
                        priceEdit?.value !== null && priceEdit?.value !== undefined
                          ? String(priceEdit.value)
                          : variant.price ?? "0.00";

                      // Qty: edited value → saved metafield value → 1
                      const qtyValue =
                        qtyEdit?.value !== null && qtyEdit?.value !== undefined
                          ? String(qtyEdit.value)
                          : "1";

                      return (
                        <s-grid
                          key={variant.id}
                          gridTemplateColumns={gridColumns}
                          gap="small"
                          alignItems="center"
                        >
                          <s-text>{variant.title}</s-text>

                          <s-money-field
                            label={selectedTier.label}
                            labelAccessibilityVisibility="exclusive"
                            name={`price-${variant.id}`}
                            value={priceValue}
                            min={0}
                            disabled={saving || pageLoading}
                            onChange={(e) =>
                              handlePriceChange(
                                variant.id,
                                selectedTier.priceKey,
                                e.currentTarget.value,
                              )
                            }
                          />

                          {selectedTier.qtyKey ? (
                            <s-number-field
                              label="Min Qty"
                              labelAccessibilityVisibility="exclusive"
                              name={`qty-${variant.id}`}
                              value={qtyValue}
                              min={1}
                              step={1}
                              inputMode="numeric"
                              disabled={saving || pageLoading}
                              onChange={(e) =>
                                handleQtyChange(
                                  variant.id,
                                  selectedTier.qtyKey,
                                  e.currentTarget.value,
                                )
                              }
                            />
                          ) : null}
                        </s-grid>
                      );
                    })}
                  </s-stack>
                )}

                {hasMultiplePages ? (
                  <s-stack
                    direction="inline"
                    gap="base"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-button
                      onClick={handlePrevPage}
                      disabled={!canGoPrev || pageLoading || saving}
                    >
                      Previous
                    </s-button>
                    <s-text tone="subdued">Page {currentPage}</s-text>
                    <s-button
                      onClick={handleNextPage}
                      disabled={!canGoNext || pageLoading || saving}
                    >
                      Next
                    </s-button>
                  </s-stack>
                ) : null}

              </s-stack>
            ) : null}

          </s-stack>
        )}

      </s-stack>

      <s-button
        slot="primary-action"
        onClick={handleSave}
        disabled={loading || saving}
        loading={saving}
      >
        Save
      </s-button>
      <s-button
        slot="secondary-actions"
        onClick={handleCancel}
        disabled={saving}
      >
        Cancel
      </s-button>
    </s-admin-action>
  );
}
