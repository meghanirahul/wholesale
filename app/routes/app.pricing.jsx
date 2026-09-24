import { authenticate } from "../shopify.server"
import { useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";

export const loader = async ({ request }) => {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const tierId = url.searchParams.get("id");
    console.log("Pricing tier id:", tierId);
    const response = await admin.graphql(
        `#graphql
            query GetProducts {
                shop {
                  currencyCode
                }
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
                products(first: 50) {
                    nodes {
                        id
                        title
                        media(first:1){
                            nodes{
                                preview{
                                    image{
                                        url
                                    }
                                }
                            }
                        }
                        priceRangeV2{
                            maxVariantPrice{
                                amount
                            }
                            minVariantPrice{
                                amount
                            }
                        }
                        variantsCount{
                            count
                        }
                        variants(first: 100){
                            nodes{
                                id  
                                title
                                price
                                metafields(
                                    namespace: "$app"
                                    first: 100
                                ) {
                                    nodes {
                                        id
                                        key
                                        type
                                        value
                                    }
                                }
                            }
                            pageInfo{
                                endCursor
                                hasNextPage
                                hasPreviousPage
                                startCursor
                            }
                        }
                    }
                    pageInfo{
                        endCursor
                        hasNextPage
                        hasPreviousPage
                        startCursor
                    }
                }
            }
        `
    );
    const products = await response.json();
    return { products, tierId };
}

export default function Pricing() {
    const { products, tierId } = useLoaderData();
    const [toogle, setToogle] = useState(false);
    console.log(products, tierId)
    const tierField = products.data.metafieldDefinitions.nodes.find(metafield => `gid://shopify/MetafieldDefinition/${tierId}` === metafield.id);
    const quantityField = products.data.metafieldDefinitions.nodes.find(metafield => metafield.key === `${tierField.key}_min`);
    const quantityFieldId = quantityField ? quantityField.id : null;
    const showallVariant = async (product) => {
        setToogle(!toogle);
    }
    return (
        <>
            <s-page>
                <s-section>
                    <s-form>
                        <s-table>
                            <s-table-header-row>
                                <s-table-header></s-table-header>
                                <s-table-header>Product</s-table-header>
                                <s-table-header>Price in {products.data.shop.currencyCode ? products.data.shop.currencyCode : ''}</s-table-header>
                                <s-table-header>Min Quantity</s-table-header>
                                <s-table-header>Regular Price</s-table-header>
                            </s-table-header-row>
                            <s-table-body>
                                {products.data.products.nodes.length && products.data.products.nodes.map((product) => (
                                    <>
                                        <s-table-row>
                                            <s-table-cell>
                                                <s-grid maxInlineSize="40px" justifyContent="center">
                                                    {(product?.media?.nodes[0]?.preview?.image?.url) ? (
                                                        <s-image alt={product.title} src={product.media.nodes[0].preview.image.url} aspectRatio="1 / 1" objectFit="cover" borderRadius="base" inlineSize="fill" />
                                                    ) : (
                                                        <s-icon type="image" size="40" ></s-icon>
                                                    )}
                                                </s-grid>
                                            </s-table-cell>
                                            <s-table-cell>
                                                <s-stack direction="block" gap="small-500">
                                                    <s-text>{product.title}</s-text>
                                                    {product.variants.nodes.length > 1 && (<>
                                                        <s-stack direction="inline" gap="small-400" justifyContent="start" alignItems="center">
                                                            <s-text>{product.variantsCount.count} variants</s-text>
                                                            <s-button variant="tertiary" icon={toogle ? "caret-down" : "caret-left"} onClick={() => showallVariant(product)}></s-button>
                                                        </s-stack>
                                                    </>)}
                                                </s-stack>
                                            </s-table-cell>
                                            <s-table-cell>
                                                <s-stack maxInlineSize="150px" justifyContent="space-between" direction="inline" alignItems="center">
                                                    {product.variants.nodes.length === 1 ? (
                                                        <s-money-field
                                                            value={product.variants.nodes[0].metafields.nodes.find((metafield) => metafield.id === `gid://shopify/MetafieldDefinition/${tierId}`)?.value?.amount || product.variants.nodes[0].price}
                                                        />
                                                    ) : (
                                                        <>
                                                            <s-text>{product.priceRangeV2.minVariantPrice.amount} - {product.priceRangeV2.maxVariantPrice.amount}</s-text>
                                                        </>
                                                    )}
                                                </s-stack>
                                            </s-table-cell>
                                            <s-table-cell>
                                                <s-stack maxInlineSize="80px">
                                                    {product.variants.nodes.length === 1 ? (
                                                        <s-number-field
                                                            min={1}
                                                            step={1}
                                                            value={product.variants.nodes[0].metafields.nodes.find((metafield) => metafield.id === quantityFieldId)?.value || 1}
                                                        />
                                                    ) : (
                                                        <s-text>-</s-text>
                                                    )}
                                                </s-stack>
                                            </s-table-cell>
                                            <s-table-cell>
                                                <s-stack maxInlineSize="150px">
                                                    {product.variants.nodes.length === 1 ? (
                                                        <s-money-field disabled value={product.variants.nodes[0].price}></s-money-field>
                                                    ) : (
                                                        <s-text>-</s-text>
                                                    )}
                                                </s-stack>
                                            </s-table-cell>
                                        </s-table-row>
                                    </>
                                ))}
                            </s-table-body>
                        </s-table>
                    </s-form>
                </s-section>
            </s-page>
        </>
    )
}