use super::schema;
use crate::schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::HashMap;

/// Represents a parsed money value with an optional currency code.
#[derive(Debug, PartialEq)]
pub struct ParsedMoney {
    pub amount: f64,
    pub currency_code: Option<String>,
}

/// Extracts the `amount` and optional `currency_code` from a Shopify money metafield value string.
/// Handles both plain decimals ("500.00") and JSON objects ({"amount":"500.00","currency_code":"USD"}).
pub fn parse_money_value(value: &str) -> Option<ParsedMoney> {
    let s = value.trim();
    if s.is_empty() {
        return None;
    }

    // Fast path: plain numeric string
    if let Ok(n) = s.parse::<f64>() {
        return if n >= 0.0 {
            Some(ParsedMoney { amount: n, currency_code: None })
        } else {
            None
        };
    }

    // JSON path: extract "amount"
    let amount_key = "\"amount\"";
    let amount_pos = s.find(amount_key)?;
    let after_amount = s[amount_pos + amount_key.len()..].trim_start();
    let after_amount = after_amount.trim_start_matches(':').trim_start();
    let amount_str = if after_amount.starts_with('"') {
        let inner = &after_amount[1..];
        let end = inner.find('"')?;
        &inner[..end]
    } else {
        let end = after_amount
            .find(|c: char| c == ',' || c == '}' || c.is_ascii_whitespace())
            .unwrap_or(after_amount.len());
        &after_amount[..end]
    };
    let amount = amount_str.trim().parse::<f64>().ok()?;
    if amount < 0.0 {
        return None;
    }

    // JSON path: extract optional "currency_code"
    let currency_key = "\"currency_code\"";
    let currency_code = if let Some(curr_pos) = s.find(currency_key) {
        let after_curr = s[curr_pos + currency_key.len()..].trim_start();
        let after_curr = after_curr.trim_start_matches(':').trim_start();
        if after_curr.starts_with('"') {
            let inner = &after_curr[1..];
            inner.find('"').map(|end| inner[..end].to_uppercase())
        } else {
            None
        }
    } else {
        None
    };

    Some(ParsedMoney { amount, currency_code })
}

/// Parses minimum purchase quantity string (defaults to 1 if absent or invalid).
pub fn parse_min_qty(value: &str) -> i64 {
    value.trim().parse::<i64>().unwrap_or(1).max(1)
}

/// Calculates per-unit fixed discount.
/// Returns None if tier price is >= regular price, zero, or negative.
pub fn calculate_per_unit_discount(regular_price_pres: f64, tier_price_pres: f64) -> Option<f64> {
    if tier_price_pres <= 0.0 || tier_price_pres >= regular_price_pres {
        return None;
    }
    let discount = ((regular_price_pres - tier_price_pres) * 100.0).round() / 100.0;
    if discount > 0.0 { Some(discount) } else { None }
}

/// Extracts a string field value from a minimal JSON object by key name.
/// e.g. extract_string_field(`{"tierName":"VIP Pricing"}`, "tierName") => Some("VIP Pricing")
pub fn extract_string_field<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let search = format!("\"{}\"", key);
    let key_pos = json.find(&search)?;
    let after_key = json[key_pos + search.len()..].trim_start();
    let after_colon = after_key.trim_start_matches(':').trim_start();
    if after_colon.starts_with('"') {
        let inner = &after_colon[1..];
        let end = inner.find('"')?;
        Some(&inner[..end])
    } else {
        None
    }
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let no_ops = schema::CartLinesDiscountsGenerateRunResult { operations: vec![] };

    // ── 1. Guard: no cart lines ───────────────────────────────────────────
    if input.cart().lines().is_empty() {
        return Ok(no_ops);
    }

    // ── 2. Check buyer tag eligibility via dynamic $tags variable ─────────
    //
    // Shopify reads tier_customer_tags from this discount node and injects
    // its "tags" array as the $tags input variable at checkout.
    // has_tag = hasAnyTag(tags: $tags)
    let buyer_identity = match input.cart().buyer_identity() {
        Some(bi) => bi,
        None => return Ok(no_ops),
    };
    let customer = match buyer_identity.customer() {
        Some(c) => c,
        None => return Ok(no_ops),
    };

    let has_tag = *customer.has_tag();
    if !has_tag {
        return Ok(no_ops);
    }

    log!("[TierDiscount] Customer qualifies for this tier");

    // ── 3. Resolve tier title for discount label ──────────────────────────
    // Read tierName from the discount node's tier_customer_tags metafield.
    let tier_title: String = input.discount()
        .tier_tags()
        .as_ref()
        .and_then(|m| extract_string_field(m.value(), "tierName"))
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Tier Pricing".to_string());

    log!("[TierDiscount] Tier title: {}", tier_title);

    // ── 4. Get presentment currency rate ──────────────────────────────────
    let rate: f64 = input.presentment_currency_rate().0;
    let rate = if rate <= 0.0 { 1.0 } else { rate };

    // ── 5. Aggregate quantities for the same variant across cart lines ────
    let mut variant_total_quantities: HashMap<String, i64> = HashMap::new();
    for line in input.cart().lines().iter() {
        if let Merchandise::ProductVariant(variant) = line.merchandise() {
            let qty = *line.quantity() as i64;
            *variant_total_quantities.entry(variant.id().clone()).or_insert(0) += qty;
        }
    }

    // ── 6. Build discount candidates ──────────────────────────────────────
    //
    // Each variant has:
    //   tier_price: metafield(namespace: "$app", key: $priceKey)  ← dynamic key via input_variables
    //   tier_min:   metafield(namespace: "$app", key: $qtyKey)    ← dynamic key via input_variables
    let mut candidates: Vec<schema::ProductDiscountCandidate> = vec![];

    for line in input.cart().lines().iter() {
        let variant = match line.merchandise() {
            Merchandise::ProductVariant(v) => v,
            _ => continue,
        };

        let total_variant_qty = variant_total_quantities
            .get(variant.id())
            .copied()
            .unwrap_or(0);

        // Read tier price from the dynamically selected metafield ($priceKey)
        let price_raw = variant.tier_price().as_ref().map(|m| m.value().as_str());
        let parsed_price = match price_raw.and_then(parse_money_value) {
            Some(p) => p,
            None => continue, // No tier price configured for this variant — skip
        };

        // Read min quantity from the dynamically selected metafield ($qtyKey)
        let min_raw = variant.tier_min().as_ref().map(|m| m.value().as_str());
        let min_qty = min_raw.map(parse_min_qty).unwrap_or(1);

        if total_variant_qty < min_qty {
            log!(
                "[TierDiscount] Skipping line {}: qty {} < min_qty {}",
                line.id(),
                total_variant_qty,
                min_qty
            );
            continue;
        }

        // Tier price is stored in the store's base currency.
        // Multiply by presentmentCurrencyRate to convert to customer's currency.
        let tier_price_presentment = (parsed_price.amount * rate * 100.0).round() / 100.0;

        // Cart's amountPerQuantity is already in presentment currency.
        let regular_price: f64 = line.cost().amount_per_quantity().amount().0;

        let per_unit_discount = match calculate_per_unit_discount(regular_price, tier_price_presentment) {
            Some(d) => d,
            None => {
                log!(
                    "[TierDiscount] No discount for line {}: regular={:.2} tier={:.2}",
                    line.id(),
                    regular_price,
                    tier_price_presentment
                );
                continue;
            }
        };

        log!(
            "[TierDiscount] line={} qty={} regular={:.2} tier_base={:.2} tier_pres={:.2} discount={:.2}",
            line.id(),
            total_variant_qty,
            regular_price,
            parsed_price.amount,
            tier_price_presentment,
            per_unit_discount
        );

        candidates.push(schema::ProductDiscountCandidate {
            targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                schema::CartLineTarget {
                    id: line.id().clone(),
                    quantity: None,
                },
            )],
            message: Some(tier_title.clone()),
            associated_discount_code: None,
            prerequisites: None,
            value: schema::ProductDiscountCandidateValue::FixedAmount(
                schema::ProductDiscountCandidateFixedAmount {
                    amount: Decimal(per_unit_discount),
                    applies_to_each_item: Some(true),
                },
            ),
        });
    }

    if candidates.is_empty() {
        return Ok(no_ops);
    }

    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::All,
                candidates,
            },
        )],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_money_plain() {
        assert_eq!(
            parse_money_value("500.00"),
            Some(ParsedMoney { amount: 500.00, currency_code: None })
        );
        assert_eq!(parse_money_value("-1.00"), None);
        assert_eq!(parse_money_value(""), None);
    }

    #[test]
    fn test_parse_money_json() {
        assert_eq!(
            parse_money_value("{\"amount\": \"15.00\", \"currency_code\": \"USD\"}"),
            Some(ParsedMoney { amount: 15.00, currency_code: Some("USD".to_string()) })
        );
    }

    #[test]
    fn test_parse_min_qty() {
        assert_eq!(parse_min_qty("5"), 5);
        assert_eq!(parse_min_qty(""), 1);
        assert_eq!(parse_min_qty("0"), 1);
    }

    #[test]
    fn test_calculate_per_unit_discount_usd() {
        let rate = 1.0_f64;
        let tier_pres = (500.0_f64 * rate * 100.0).round() / 100.0;
        assert_eq!(calculate_per_unit_discount(700.0, tier_pres), Some(200.0));
    }

    #[test]
    fn test_calculate_per_unit_discount_inr() {
        let rate = 83.5_f64;
        let tier_pres = (500.0_f64 * rate * 100.0).round() / 100.0;
        let regular_inr = 700.0 * rate;
        assert_eq!(calculate_per_unit_discount(regular_inr, tier_pres), Some(16700.0));
    }

    #[test]
    fn test_no_discount_when_tier_equal_or_higher() {
        assert_eq!(calculate_per_unit_discount(700.0, 700.0), None);
        assert_eq!(calculate_per_unit_discount(700.0, 800.0), None);
    }

    #[test]
    fn test_extract_string_field() {
        let json = r#"{"tags":["VIP"],"priceKey":"vip_pricing","tierName":"VIP Pricing"}"#;
        assert_eq!(extract_string_field(json, "tierName"), Some("VIP Pricing"));
        assert_eq!(extract_string_field(json, "priceKey"), Some("vip_pricing"));
        assert_eq!(extract_string_field(json, "missing"), None);
    }
}