export default function AboutUs() {
    const features = [
        "Per-variant wholesale prices stored as Shopify metafields",
        "Minimum order quantity rules per variant",
        "Customer tag–based tier eligibility — no customer metafield writes needed",
        "Multi-currency aware via presentmentCurrencyRate",
        "Automatic discount activation on every app load",
        "Combines with order and shipping discounts",
    ];

    const stack = [
        "Shopify",
        "Shopify Plus",
        "Shopify Functions (Rust)",
        "Shopify Admin API (GraphQL)",
        "React / Remix",
        "Node.js",
        "Firestore",
        "Commerce Automations",
    ];

    return (
        <s-page
            heading="About Us"
            description="Wholesale Pricing — built and maintained by a Shopify engineer specialising in B2B commerce, custom apps, and Shopify Functions."
        >

            {/* App overview */}
            <s-section heading="What this app does">
                <s-stack direction="block" gap="base">
                    <s-text>
                        Wholesale Pricing lets you create up to three independent B2B pricing tiers —
                        {" "}<s-text type="strong">VIP</s-text>,{" "}
                        <s-text type="strong">Wholesale</s-text>, and{" "}
                        <s-text type="strong">B2B</s-text> — each with its own per-variant prices,
                        minimum order quantities, and eligible customer tags. Discounts apply
                        automatically at checkout via Shopify Functions, with no discount codes needed.
                    </s-text>

                    <s-stack direction="block" gap="small-400">
                        {features.map((feat) => (
                            <s-stack key={feat} direction="inline" gap="small-400" alignItems="center">
                                <s-icon type="checkmark-circle" />
                                <s-text>{feat}</s-text>
                            </s-stack>
                        ))}
                    </s-stack>
                </s-stack>
            </s-section>

            {/* Developer bio */}
            <s-section heading="About the developer">
                <s-stack direction="block" gap="base">
                    <s-text>
                        Hi, I&apos;m{" "}
                        <s-text type="strong">Rahul Meghani</s-text> — a Shopify engineer focused
                        on the parts of commerce that require more than theme edits. I work on
                        storefront engineering, custom Shopify apps, Shopify Functions &amp; checkout
                        logic, third-party integrations, and complex data migrations.
                    </s-text>
                    <s-text tone="subdued">
                        Past work includes Plus personalisation &amp; recommendations, multi-tier B2B
                        commerce implementations, quiz funnels, storefront automation, and large
                        catalogue migrations. I&apos;ve worked agency-side at WebContrive and Dynamic
                        Dreamz, and now take on direct client &amp; product work. Available worldwide
                        for remote engagements.
                    </s-text>
                    <s-link url="http://meghanirahul.comeasy.app/" external>
                        View full portfolio →
                    </s-link>
                </s-stack>
            </s-section>

            {/* Tech stack */}
            <s-section heading="Technical stack">
                <s-stack direction="inline" gap="small" wrap>
                    {stack.map((tech) => (
                        <s-badge key={tech} tone="neutral">{tech}</s-badge>
                    ))}
                </s-stack>
            </s-section>

        </s-page>
    );
}
