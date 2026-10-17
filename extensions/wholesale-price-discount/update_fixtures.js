import fs from 'fs';
import path from 'path';

const fixturesDir = './tests/fixtures';
const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'));

for (const file of files) {
    const filePath = path.join(fixturesDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (data.payload && data.payload.input && data.payload.input.cart) {
        const cart = data.payload.input.cart;
        if (cart.buyerIdentity && cart.buyerIdentity.customer) {
            const cust = cart.buyerIdentity.customer;
            const isVip = Boolean(cust.vip_pricing || cust.has_vip);
            cart.buyerIdentity.customer = {
                has_vip: isVip
            };
        }

        if (cart.lines) {
            for (const line of cart.lines) {
                if (line.merchandise) {
                    const m = line.merchandise;
                    delete m.wholesale_price;
                    delete m.wholesale_min;
                    delete m.b2b_price;
                    delete m.b2b_min;
                }
            }
        }
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

console.log('Fixtures updated successfully!');
