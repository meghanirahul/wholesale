const CONTACTS = [
    {
        label: "Email",
        value: "meghanirahul2023.katargam@gmail.com",
        url: "mailto:meghanirahul2023.katargam@gmail.com",
        external: false,
        icon: "email",
    },
    {
        label: "WhatsApp",
        value: "+91 94082 87186",
        url: "https://wa.me/919408287186",
        external: true,
        icon: "chat-bubble",
    },
    {
        label: "LinkedIn",
        value: "/in/rahul-meghani",
        url: "https://www.linkedin.com/in/rahul-meghani-34277b31b/",
        external: true,
        icon: "person",
    },
    {
        label: "Book a call",
        value: "Schedule on Calendly",
        url: "https://calendly.com/d/d3hn-w48-9bz",
        external: true,
        icon: "calendar",
    },
    {
        label: "Upwork",
        value: "View verified profile",
        url: "https://www.upwork.com/freelancers/~019353dc871814449f",
        external: true,
        icon: "external-small",
    },
];

export default function ContactUs() {
    return (
        <s-page
            heading="Contact Us"
            description="Questions about the app, setup help, or spotted a bug? We typically respond the same day."
        >

            {/* Contact channels */}
            <s-section heading="Contact channels">
                <s-stack direction="block" gap="base">
                    {CONTACTS.map(({ label, value, url, external, icon }, idx) => (
                        <s-stack key={label} direction="block" gap="small-200">
                            <s-stack direction="inline" gap="base" alignItems="center">
                                <s-icon type={icon} />
                                <s-stack direction="block" gap="small-100">
                                    <s-text type="strong">{label}</s-text>
                                    <s-link url={url} external={external || undefined}>
                                        {value}
                                    </s-link>
                                </s-stack>
                            </s-stack>
                            {idx < CONTACTS.length - 1 && <s-divider />}
                        </s-stack>
                    ))}
                </s-stack>
            </s-section>

            {/* Live chat */}
            <s-section heading="Live chat">
                <s-banner tone="info">
                    <s-stack direction="block" gap="small-200">
                        <s-text type="strong">Chat with us directly</s-text>
                        <s-text>
                            Use the live chat bubble in the bottom-right corner of this app to send
                            a message instantly. Powered by Tawk.to — messages go directly to Rahul.
                        </s-text>
                    </s-stack>
                </s-banner>
            </s-section>

            {/* Portfolio */}
            <s-section heading="Developer portfolio">
                <s-stack direction="inline" gap="small" alignItems="center">
                    <s-text tone="subdued">See full work history and case studies at</s-text>
                    <s-link url="http://meghanirahul.comeasy.app/" external>
                        meghanirahul.comeasy.app
                    </s-link>
                </s-stack>
            </s-section>

        </s-page>
    );
}
