import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Shopify metafield raw string into a usable JS value.
 *
 * money           -> { amount: "10.00", currency_code: "CAD" }
 * number_integer  -> number
 * number_decimal  -> number
 * everything else -> raw string
 */
function parseMetafieldValue(type, rawValue) {
  if (rawValue == null) return null;

  try {
    if (type === "money") {
      return JSON.parse(rawValue);
    }

    if (type === "number_integer") {
      return parseInt(rawValue, 10);
    }

    if (type === "number_decimal") {
      return parseFloat(rawValue);
    }

    return rawValue;
  } catch {
    return rawValue;
  }
}

/**
 * Converts a metafield into the value expected by the UI field.
 *
 * money           -> "10.00"
 * number_integer  -> "10"
 * number_decimal  -> "10.5"
 * everything else -> string
 */
function toEditableValue(metafield) {
  if (!metafield || metafield.value == null) {
    return null;
  }

  if (metafield.type === "money") {
    return metafield.value.amount ?? null;
  }

  if (
    metafield.type === "number_integer" ||
    metafield.type === "number_decimal"
  ) {
    return String(metafield.value);
  }

  return String(metafield.value);
}

/**
 * Compare editable values safely.
 */
function valuesEqual(a, b) {
  return String(a ?? "") === String(b ?? "");
}

/**
 * Deep-clone the editable state so reset/save snapshots do not share
 * mutable references.
 */
function cloneEditedValues(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, item]) => [
      key,
      {
        id: item?.id ?? null,
        type: item?.type ?? null,
        value: item?.value ?? null,
      },
    ]),
  );
}

/**
 * Convert metafield definition + actual metafield value into a map:
 *
 * {
 *   vip_pricing: {
 *     id,
 *     key,
 *     name,
 *     type,
 *     value
 *   }
 * }
 */
function buildMetafieldMap(definitionEdges, variantMetafieldEdges) {
  const valuesByKey = {};

  for (const { node } of variantMetafieldEdges) {
    valuesByKey[node.key] = node;
  }

  const map = {};

  for (const { node: definition } of definitionEdges) {
    const variantMetafield = valuesByKey[definition.key];

    map[definition.key] = {
      id: variantMetafield?.id ?? null,
      key: definition.key,
      name: definition.name,
      type: definition.type.name,
      value: variantMetafield
        ? parseMetafieldValue(
          definition.type.name,
          variantMetafield.value,
        )
        : null,
    };
  }

  return map;
}

/**
 * Automatically discovers tiers:
 *
 * vip_pricing       -> price
 * vip_pricing_min   -> quantity
 *
 * wholesale_pricing -> price
 * wholesale_pricing_min -> quantity
 */
function buildTiers(metafieldMap) {
  return Object.keys(metafieldMap)
    .filter((key) => key.endsWith("_pricing"))
    .map((priceKey) => ({
      label: metafieldMap[priceKey].name,
      priceKey,
      qtyKey: metafieldMap[`${priceKey}_min`]
        ? `${priceKey}_min`
        : null,
    }));
}

/**
 * Convert UI value into the string Shopify expects in metafieldsSet.
 *
 * Important:
 * metafieldsSet.value is ALWAYS a String.
 */
function serializeMetafieldValue(
  type,
  value,
  currencyCode,
  existingCurrencyCode = null,
) {
  if (type === "money") {
    const amount = String(value ?? "").trim();

    if (!amount) {
      throw new Error("Price cannot be empty.");
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < 0) {
      throw new Error(`Invalid price: ${amount}`);
    }

    return JSON.stringify({
      amount,
      currency_code:
        existingCurrencyCode || currencyCode || "USD",
    });
  }

  if (type === "number_integer") {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue)) {
      throw new Error(
        `Invalid integer value: ${String(value)}`,
      );
    }

    return String(numberValue);
  }

  if (type === "number_decimal") {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue)) {
      throw new Error(
        `Invalid decimal value: ${String(value)}`,
      );
    }

    return String(numberValue);
  }

  return String(value ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

function Extension() {
  const { i18n } = shopify;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState(null);

  const [defaultPrice, setDefaultPrice] = useState("0.00");
  const [currencyCode, setCurrencyCode] = useState("USD");

  const [metafieldMap, setMetafieldMap] = useState({});
  const [tiers, setTiers] = useState([]);

  // Current editable values
  const [editedValues, setEditedValues] = useState({});

  // Last successfully loaded/saved values.
  // Shopify's contextual Save Bar uses the s-form state/change tracking.
  const [initialEditedValues, setInitialEditedValues] =
    useState({});

  useEffect(() => {
    fetchData();
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Load variant data
  // ───────────────────────────────────────────────────────────────────────────

  const fetchData = async () => {
    const variantId = shopify.data.selected?.[0]?.id;

    if (!variantId) {
      setError("Unable to determine the selected product variant.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "shopify:admin/api/graphql.json",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `
              query VariantWholesalePricing($variantId: ID!) {
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

                productVariant(id: $variantId) {
                  id
                  price

                  metafields(
                    namespace: "$app"
                    first: 100
                  ) {
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
              }
            `,
            variables: {
              variantId,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Shopify API request failed: ${response.status}`,
        );
      }

      const json = await response.json();

      if (json.errors?.length) {
        throw new Error(json.errors[0].message);
      }

      const data = json.data;

      if (!data) {
        throw new Error("Shopify returned no data.");
      }

      const definitionEdges =
        data.metafieldDefinitions?.edges ?? [];

      const variantNode = data.productVariant;

      if (!variantNode) {
        throw new Error(
          "Selected product variant could not be found.",
        );
      }

      const variantMetafieldEdges =
        variantNode.metafields?.edges ?? [];

      const shopCurrency =
        data.shop?.currencyCode || "USD";

      const mfMap = buildMetafieldMap(
        definitionEdges,
        variantMetafieldEdges,
      );

      const discoveredTiers = buildTiers(mfMap);

      // Store base variant price
      setDefaultPrice(
        variantNode.price || "0.00",
      );

      setCurrencyCode(shopCurrency);

      setMetafieldMap(mfMap);
      setTiers(discoveredTiers);

      // Build the editable state.
      const initialValues = {};

      for (const key of Object.keys(mfMap)) {
        initialValues[key] = {
          id: mfMap[key].id,
          type: mfMap[key].type,
          value: toEditableValue(mfMap[key]),
        };
      }

      setEditedValues(cloneEditedValues(initialValues));
      setInitialEditedValues(
        cloneEditedValues(initialValues),
      );
    } catch (err) {
      console.error(
        "Variant pricing fetch error:",
        err,
      );

      setError(
        err?.message ||
        "Unable to load variant pricing.",
      );
    } finally {
      setLoading(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Field changes
  // ───────────────────────────────────────────────────────────────────────────

  const handlePriceChange = (
    priceKey,
    newValue,
  ) => {
    setEditedValues((previous) => ({
      ...previous,
      [priceKey]: {
        id:
          previous[priceKey]?.id ??
          metafieldMap[priceKey]?.id ??
          null,

        type:
          previous[priceKey]?.type ??
          metafieldMap[priceKey]?.type ??
          "money",

        value: newValue,
      },
    }));

    setError(null);
  };

  const handleQtyChange = (
    qtyKey,
    newValue,
  ) => {
    // s-number-field values are strings in current
    // Polaris web component form events.
    const value =
      newValue === "" || newValue == null
        ? ""
        : String(newValue);

    setEditedValues((previous) => ({
      ...previous,
      [qtyKey]: {
        id:
          previous[qtyKey]?.id ??
          metafieldMap[qtyKey]?.id ??
          null,

        type:
          previous[qtyKey]?.type ??
          metafieldMap[qtyKey]?.type ??
          "number_integer",

        value,
      },
    }));

    setError(null);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Discard
  // ───────────────────────────────────────────────────────────────────────────

  const discardChanges = async () => {
    setEditedValues(
      cloneEditedValues(initialEditedValues),
    );

    setError(null);
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Save
  // ───────────────────────────────────────────────────────────────────────────

  const savePricing = async () => {
    if (saving) {
      return;
    }

    const variantId =
      shopify.data.selected?.[0]?.id;

    if (!variantId) {
      throw new Error(
        "Unable to determine the selected product variant.",
      );
    }

    setSaving(true);
    setError(null);

    try {
      const changedMetafields = [];

      for (const [key, current] of Object.entries(
        editedValues,
      )) {
        const initial = initialEditedValues[key];

        const currentValue =
          current?.value ?? null;

        const initialValue =
          initial?.value ?? null;

        // Only send fields that actually changed.
        if (
          valuesEqual(
            currentValue,
            initialValue,
          )
        ) {
          continue;
        }

        const definition = metafieldMap[key];

        if (!definition) {
          continue;
        }

        const rawValue =
          current?.value ?? "";

        // Validate integer quantity.
        if (
          definition.type === "number_integer"
        ) {
          const numericValue =
            Number(rawValue);

          if (
            !Number.isInteger(numericValue) ||
            numericValue < 1
          ) {
            throw new Error(
              `${definition.name} must be a whole number of at least 1.`,
            );
          }
        }

        // Validate decimal value.
        if (
          definition.type === "number_decimal"
        ) {
          const numericValue =
            Number(rawValue);

          if (
            !Number.isFinite(numericValue)
          ) {
            throw new Error(
              `${definition.name} must be a valid number.`,
            );
          }
        }

        // Existing money metafield may already contain
        // a currency code. Preserve it when updating.
        const existingCurrency =
          definition.type === "money"
            ? definition.value?.currency_code ||
            null
            : null;

        const serializedValue =
          serializeMetafieldValue(
            definition.type,
            rawValue,
            currencyCode,
            existingCurrency,
          );

        changedMetafields.push({
          key,
          ownerId: variantId,
          type: definition.type,
          value: serializedValue,
        });
      }

      // Nothing changed.
      if (changedMetafields.length === 0) {
        return;
      }

      // Shopify currently allows a maximum of 25
      // metafields in one metafieldsSet mutation.
      if (changedMetafields.length > 25) {
        throw new Error(
          "Too many metafields changed at once. Shopify allows a maximum of 25 metafields per metafieldsSet request.",
        );
      }

      const response = await fetch(
        "shopify:admin/api/graphql.json",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `
              mutation SetVariantMetafields(
                $metafields: [MetafieldsSetInput!]!
              ) {
                metafieldsSet(
                  metafields: $metafields
                ) {
                  metafields {
                    id
                    key
                    namespace
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
            variables: {
              metafields: changedMetafields,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Shopify save request failed: ${response.status}`,
        );
      }

      const json = await response.json();

      if (json.errors?.length) {
        throw new Error(
          json.errors[0].message,
        );
      }

      const payload =
        json.data?.metafieldsSet;

      if (!payload) {
        throw new Error(
          "Shopify did not return a metafieldsSet response.",
        );
      }

      if (payload.userErrors?.length) {
        const message =
          payload.userErrors
            .map(
              (userError) =>
                userError.message,
            )
            .join(", ");

        throw new Error(message);
      }

      console.log(
        "Variant pricing saved:",
        payload.metafields,
      );

      // The currently edited state is now the saved state.
      setInitialEditedValues(
        cloneEditedValues(editedValues),
      );

      // Update local IDs for metafields that may
      // have just been created.
      if (payload.metafields?.length) {
        setMetafieldMap((previous) => {
          const next = {
            ...previous,
          };

          for (const saved of payload.metafields) {
            if (next[saved.key]) {
              next[saved.key] = {
                ...next[saved.key],
                id: saved.id,
                value: parseMetafieldValue(
                  saved.type,
                  saved.value,
                ),
              };
            }
          }

          return next;
        });

        setEditedValues((previous) => {
          const next = {
            ...previous,
          };

          for (const saved of payload.metafields) {
            if (next[saved.key]) {
              next[saved.key] = {
                ...next[saved.key],
                id: saved.id,
              };
            }
          }

          return next;
        });
      }
    } catch (err) {
      console.error(
        "Variant pricing save error:",
        err,
      );

      setError(
        err?.message ||
        "Unable to save variant pricing.",
      );

      // Reject the submit promise so Shopify does
      // not treat a failed save as successful.
      throw err;
    } finally {
      setSaving(false);
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Render error
  // ───────────────────────────────────────────────────────────────────────────

  if (error && !loading) {
    return (
      <s-admin-block heading="Wholesale Pricing">
        <s-stack
          direction="block"
          gap="base"
        >
          <s-banner tone="critical">
            {error}
          </s-banner>

          <s-button
            onClick={fetchData}
            disabled={saving}
          >
            Try again
          </s-button>
        </s-stack>
      </s-admin-block>
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <s-admin-block heading="Wholesale Pricing">
      <s-stack
        direction="block"
        gap="base"
      >
        <s-text type="strong">
          {i18n.translate("pricing")}
        </s-text>

        {error && (
          <s-banner tone="critical">
            {error}
          </s-banner>
        )}

        {saving && (
          <s-stack
            direction="inline"
            gap="small"
            alignItems="center"
          >
            <s-spinner />
            <s-text tone="subdued">
              Saving pricing...
            </s-text>
          </s-stack>
        )}

        <s-form
          onSubmit={savePricing}
          onReset={discardChanges}
        >
          {loading ? (
            <s-spinner />
          ) : tiers.length === 0 ? (
            <s-text tone="subdued">
              No wholesale pricing tiers defined.
            </s-text>
          ) : (
            <s-stack
              direction="block"
              gap="base"
            >
              {tiers.map(
                ({
                  label,
                  priceKey,
                  qtyKey,
                }) => {
                  const priceMf =
                    metafieldMap[priceKey];

                  const qtyMf = qtyKey
                    ? metafieldMap[qtyKey]
                    : null;

                  // Current edited price.
                  const editedPrice =
                    editedValues[priceKey]
                      ?.value;

                  const priceValue =
                    editedPrice !== null &&
                      editedPrice !== undefined
                      ? String(editedPrice)
                      : priceMf?.value
                        ?.amount != null
                        ? String(
                          priceMf.value.amount,
                        )
                        : String(
                          defaultPrice,
                        );

                  // Current edited quantity.
                  const editedQty = qtyKey
                    ? editedValues[qtyKey]
                      ?.value
                    : null;

                  const qtyValue =
                    editedQty !== null &&
                      editedQty !== undefined &&
                      editedQty !== ""
                      ? String(editedQty)
                      : qtyMf?.value != null
                        ? String(
                          qtyMf.value,
                        )
                        : "1";

                  return (
                    <s-grid
                      key={priceKey}
                      gridTemplateColumns="3fr 1fr"
                      gap="small"
                      justifyContent="start"
                      alignItems="start"
                    >
                      {/* Price */}
                      <s-stack
                        direction="block"
                        gap="small-500"
                      >
                        <s-money-field
                          label={label}
                          name={priceKey}
                          value={priceValue}
                          min={0}
                          disabled={saving}
                          onChange={(event) =>
                            handlePriceChange(
                              priceKey,
                              event
                                .currentTarget
                                .value,
                            )
                          }
                        />
                      </s-stack>

                      {/* Quantity */}
                      <s-stack
                        direction="block"
                        gap="small-500"
                        maxInlineSize="100px"
                      >
                        {qtyKey && (
                          <s-number-field
                            label="Min Qty"
                            name={qtyKey}
                            value={qtyValue}
                            min={1}
                            step={1}
                            inputMode="numeric"
                            disabled={saving}
                            onChange={(event) =>
                              handleQtyChange(
                                qtyKey,
                                event
                                  .currentTarget
                                  .value,
                              )
                            }
                          />
                        )}
                      </s-stack>
                    </s-grid>
                  );
                },
              )}
            </s-stack>
          )}
        </s-form>
      </s-stack>
    </s-admin-block>
  );
}


// ─── Storefront API reference (read-only, kept for reference) ─────────────────

// query GetVariantAppPricingStorefront($variantId: ID!) {
//   node(id: $variantId) {
//     ... on ProductVariant {
//       vipPricing: metafield(key: "vip_pricing") {
//         value
//       }
//       vipPricingMin: metafield(key: "vip_pricing_min") {
//         value
//       }
//       wholesalePricing: metafield(key: "wholesale_pricing") {
//         value
//       }
//       wholesalePricingMin: metafield(key: "wholesale_pricing_min") {
//         value
//       }
//       b2bPricing: metafield(key: "b2b_pricing") {
//         value
//       }
//       b2bPricingMin: metafield(key: "b2b_pricing_min") {
//         value
//       }
//     }
//   }
// }


