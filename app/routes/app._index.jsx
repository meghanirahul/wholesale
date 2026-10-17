import { authenticate } from "../shopify.server";
import { useLoaderData, useNavigate } from "react-router";
import { useState, useCallback } from "react";

// ── Liquid snippet shown to developers/merchants ──────────────────────────────
const LIQUID_SNIPPET = `{%- comment -%}
  ══════════════════════════════════════════════════════════════════════
  Wholesale Pricing App — Tier Price Display Snippet
  ══════════════════════════════════════════════════════════════════════
  Drop this snippet inside your product card or product page template.

  What it does:
    1. Reads your 3 tier tag lists from shop metafields
    2. Checks the logged-in customer's tags to find their tier
    3. Reads the tier price from the variant's metafield
    4. Shows the tier price if set, otherwise shows the original price

  Liquid access path for the shop tier-tag metafields:
    {{ shop.metafields.app.vip_tier_tags.value }}
    {{ shop.metafields.app.wholesale_tier_tags.value }}
    {{ shop.metafields.app.b2b_tier_tags.value }}

  Variant metafield price keys (money type, stored as JSON):
    vip_pricing        → variant.metafields.app.vip_pricing
    wholesale_pricing  → variant.metafields.app.wholesale_pricing
    b2b_pricing        → variant.metafields.app.b2b_pricing
{%- endcomment -%}

{%- liquid
  assign display_variant = product.selected_or_first_available_variant
  unless display_variant
    assign display_variant = product.variants.first
  endunless

  assign customer_tier = nil

  if customer
    assign vip_tags       = shop.metafields.app--431790161921.vip_tier_tags.value | split: ","
    assign wholesale_tags = shop.metafields.app--431790161921.wholesale_tier_tags.value | split: ","
    assign b2b_tags       = shop.metafields.app--431790161921.b2b_tier_tags.value       | split: ","

    for tag in vip_tags
      assign tag_clean = tag | strip 
      if tag_clean != blank and customer.tags contains tag_clean
        assign customer_tier = "vip_pricing"
        break
      endif
    endfor

    if customer_tier == nil
      for tag in wholesale_tags
        assign tag_clean = tag | strip 
        if tag_clean != blank and customer.tags contains tag_clean
          assign customer_tier = "wholesale_pricing"
          break
        endif
      endfor
    endif

    if customer_tier == nil
      for tag in b2b_tags
        assign tag_clean = tag | strip 
        if tag_clean != blank and customer.tags contains tag_clean
          assign customer_tier = "b2b_pricing"
          break
        endif
      endfor
    endif
  endif


  assign tier_price_amount = nil

  if customer_tier == "vip_pricing"
    assign tier_mf = display_variant.metafields.app--431790161921.vip_pricing
    if tier_mf
      assign tier_price_amount = tier_mf.value
    endif
  elsif customer_tier == "wholesale_pricing"
    assign tier_mf = display_variant.metafields.app--431790161921.wholesale_pricing
    if tier_mf
      assign tier_price_amount = tier_mf.value
    endif
  elsif customer_tier == "b2b_pricing"
    assign tier_mf = display_variant.metafields.app--431790161921.b2b_pricing
    if tier_mf
      assign tier_price_amount = tier_mf.value
    endif
  endif
-%}
{%- comment -%} ── 4. Display price ─────────────────────────────────── {%- endcomment -%}
{% if tier_price_amount and tier_price_amount != blank and tier_price_amount != "0.0" %}
  <span class="price tier-price">
    {{ tier_price_amount | money }}
  </span>
  <span class="price price--compare">
    <s>{{ display_variant.price | money }}</s>
  </span>
{% else %}
  <span class="price">
    {{ display_variant.price | money }}
  </span>
{% endif %}`;


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
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(LIQUID_SNIPPET).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }, []);

  return (
    <s-page heading="Tier Pricings">
      {/* ── Tier cards ── */}
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

      {/* ── Theme Liquid Snippet ── */}
      <s-section
        heading="Theme Integration — Liquid Snippet"
        description="Copy this snippet into your theme's product card or product page template to display tier-specific prices for logged-in wholesale customers."
      >
        <s-stack direction="block" gap="base">

          {/* Info callouts */}
          <s-banner tone="info">
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">How it works</s-text>
              <s-text>
                1. Reads each tier&apos;s tag list from shop metafields (set when you save tags in this app).
              </s-text>
              <s-text>
                2. Compares the logged-in customer&apos;s tags — VIP is checked first, then Wholesale, then B2B.
              </s-text>
              <s-text>
                3. Looks up the matching tier price on the selected (or first available) variant metafield.
              </s-text>
              <s-text>
                4. Shows the tier price with the original price crossed out. Falls back to original price if no tier price is set.
              </s-text>
            </s-stack>
          </s-banner>

          <s-banner tone="warning">
            <s-text>
              <s-text type="strong">Before you paste: </s-text>
              Make sure the shop metafields are accessible to your storefront. In Shopify Admin → Settings → Custom data → Shops, confirm{" "}
              <s-text type="code">vip_tier_tags</s-text>,{" "}
              <s-text type="code">wholesale_tier_tags</s-text>, and{" "}
              <s-text type="code">b2b_tier_tags</s-text>{" "}
              have <s-text type="strong">Storefront access: Public read</s-text> enabled
              (already set by this app&apos;s TOML config after deploy).
            </s-text>
          </s-banner>

          {/* Copy button + code block */}
          <s-stack direction="inline" justifyContent="end">
            <s-button
              variant={copied ? "primary" : "secondary"}
              icon={copied ? "check" : "clipboard"}
              onClick={handleCopy}
            >
              {copied ? "Copied!" : "Copy Snippet"}
            </s-button>
          </s-stack>

          <s-box
            background="bg-surface-secondary"
            borderRadius="base"
            padding="base"
          >
            <s-text type="code">{LIQUID_SNIPPET}</s-text>
          </s-box>

          {/* Metafield reference table */}
          <s-text type="strong">Metafield reference</s-text>
          <s-box background="bg-surface-secondary" borderRadius="base" padding="base">
            <s-table>
              <s-table-body>
                <s-table-row>
                  <s-table-cell><s-text type="code">shop.metafields.app.vip_tier_tags</s-text></s-table-cell>
                  <s-table-cell><s-text>Comma-separated tags for VIP tier (e.g. <s-text type="code">VIP,Reseller</s-text>)</s-text></s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell><s-text type="code">shop.metafields.app.wholesale_tier_tags</s-text></s-table-cell>
                  <s-table-cell><s-text>Comma-separated tags for Wholesale tier</s-text></s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell><s-text type="code">shop.metafields.app.b2b_tier_tags</s-text></s-table-cell>
                  <s-table-cell><s-text>Comma-separated tags for B2B tier</s-text></s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell><s-text type="code">variant.metafields.app.vip_pricing</s-text></s-table-cell>
                  <s-table-cell><s-text>VIP price for this variant (money type)</s-text></s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell><s-text type="code">variant.metafields.app.wholesale_pricing</s-text></s-table-cell>
                  <s-table-cell><s-text>Wholesale price for this variant (money type)</s-text></s-table-cell>
                </s-table-row>
                <s-table-row>
                  <s-table-cell><s-text type="code">variant.metafields.app.b2b_pricing</s-text></s-table-cell>
                  <s-table-cell><s-text>B2B price for this variant (money type)</s-text></s-table-cell>
                </s-table-row>
              </s-table-body>
            </s-table>
          </s-box>

        </s-stack>
      </s-section>
    </s-page>
  );
}
