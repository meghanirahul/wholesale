import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { data, navigation } = shopify;
  const [productTitle, setProductTitle] = useState("");

  useEffect(() => {
    const productId = data.selected[0].id;
    fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query GetProductTitle($id: ID!) {
          product(id: $id) {
            title
          }
        }`,
        variables: { id: productId },
      }),
    })
      .then((res) => res.json())
      .then((json) => setProductTitle(json.data?.product?.title ?? ""))
      .catch((err) => console.error("Block fetch error:", err));
  }, []);

  const openModal = () => {
    navigation.navigate("extension:wholesale-price-action");
  };

  return (
    <s-admin-block heading="Wholesale Pricing">
      <s-stack direction="block" gap="base">
        {productTitle ? (
          <s-text tone="subdued">{productTitle}</s-text>
        ) : null}
        <s-stack direction="inline" justifyContent="start">
          <s-button onClick={openModal}>Set Wholesale Pricing</s-button>
        </s-stack>
      </s-stack>
    </s-admin-block>
  );
}