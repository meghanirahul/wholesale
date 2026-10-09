use super::schema;
use crate::schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise;
use shopify_function::prelude::*;
use shopify_function::Result;

/// Helper function to parse money amount from metafield value string
fn extract_money_amount(value_str: Option<&str>) -> Option<f64> {
    if let Some(val) = value_str {
        let trimmed = val.trim();
        if trimmed.is_empty() {
            return None;
        }

        // 1. Direct numeric parse (e.g. "500.85" or "500")
        if let Ok(n) = trimmed.parse::<f64>() {
            if n >= 0.0 {
                return Some(n);
            }
        }

        // 2. Extract amount string if JSON object format: {"amount": "500.85", ...}
        if let Some(idx) = trimmed.find("\"amount\"") {
            let after_key = &trimmed[idx + 8..];
            if let Some(colon_idx) = after_key.find(':') {
                let val_part = after_key[colon_idx + 1..].trim_start();
                if val_part.starts_with('"') {
                    let inner = &val_part[1..];
                    if let Some(end_quote) = inner.find('"') {
                        if let Ok(n) = inner[..end_quote].trim().parse::<f64>() {
                            if n >= 0.0 {
                                return Some(n);
                            }
                        }
                    }
                } else {
                    let end_idx = val_part
                        .find(|c: char| c == ',' || c == '}' || c.is_whitespace())
                        .unwrap_or(val_part.len());
                    if let Ok(n) = val_part[..end_idx].trim().parse::<f64>() {
                        if n >= 0.0 {
                            return Some(n);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Parses min-quantity string (defaults to 1).
fn parse_min_qty(value: &str) -> i64 {
    value.trim().parse::<i64>().unwrap_or(1)
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    // ── 1. Read buyer's assigned pricing tiers from customer metafield ──────────
    let customer_tiers: Vec<String> = {
        let mut tiers: Vec<String> = vec![];
        if let Some(bi) = input.cart().buyer_identity() {
            if let Some(customer) = bi.customer() {
                if let Some(mf) = customer.pricing_tiers() {
                    tiers = mf
                        .value()
                        .split(',')
                        .map(|s| s.trim().to_lowercase())
                        .filter(|s| !s.is_empty())
                        .collect();
                }
            }
        }
        tiers
    };

    if customer_tiers.is_empty() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    // ── 2. Evaluate cart lines ───────────────────────────────────────────────────
    let mut candidates: Vec<schema::ProductDiscountCandidate> = vec![];

    for line in input.cart().lines().iter() {
        let variant = match line.merchandise() {
            Merchandise::ProductVariant(v) => v,
            _ => continue,
        };

        let regular_price: f64 = line.cost().amount_per_quantity().amount().0;
        let qty: i64 = *line.quantity() as i64;

        let mut best_b2b: Option<f64> = None;
        let mut best_label: &str = "";

        for tier in &customer_tiers {
            let (price_raw, min_raw, label): (Option<&str>, Option<&str>, &str) =
                match tier.as_str() {
                    "vip_pricing" | "vip" => (
                        variant.vip_price().as_ref().map(|m| m.value().as_str()),
                        variant.vip_min().as_ref().map(|m| m.value().as_str()),
                        "VIP",
                    ),
                    "wholesale_pricing" | "wholesale" => (
                        variant.wholesale_price().as_ref().map(|m| m.value().as_str()),
                        variant.wholesale_min().as_ref().map(|m| m.value().as_str()),
                        "Wholesale",
                    ),
                    "b2b_pricing" | "b2b" => (
                        variant.b_2_b_price().as_ref().map(|m| m.value().as_str()),
                        variant.b_2_b_min().as_ref().map(|m| m.value().as_str()),
                        "B2B",
                    ),
                    _ => continue,
                };

            let b2b_price = match extract_money_amount(price_raw) {
                Some(p) => p,
                None => continue,
            };

            let min_qty = min_raw.map(parse_min_qty).unwrap_or(1);
            if qty < min_qty {
                continue;
            }

            // B2B price must be strictly LESS than regular price and > 0.0
            if b2b_price >= regular_price || b2b_price <= 0.0 {
                continue;
            }

            if best_b2b.is_none() || b2b_price < best_b2b.unwrap() {
                best_b2b = Some(b2b_price);
                best_label = label;
            }
        }

        if let Some(b2b) = best_b2b {
            let discount = ((regular_price - b2b) * 100.0).round() / 100.0;
            if discount <= 0.0 {
                continue;
            }

            log!(
                "[B2B] line={} regular={:.2} b2b={:.2} discount={:.2} tier={}",
                line.id(),
                regular_price,
                b2b,
                discount,
                best_label
            );

            candidates.push(schema::ProductDiscountCandidate {
                targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                    schema::CartLineTarget {
                        id: line.id().clone(),
                        quantity: None,
                    },
                )],
                // message: None keeps the original product title unaltered at checkout
                message: None,
                value: schema::ProductDiscountCandidateValue::FixedAmount(
                    schema::ProductDiscountCandidateFixedAmount {
                        amount: Decimal(discount),
                        applies_to_each_item: Some(true),
                    },
                ),
                associated_discount_code: None,
                prerequisites: None,
            });
        }
    }

    if candidates.is_empty() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
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