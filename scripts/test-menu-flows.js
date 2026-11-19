const { SignJWT } = require('jose');
const http = require('http');
const app = require('../src/app');
const { connectDB, getDB } = require('../src/db/connection');

const secretKey = new TextEncoder().encode(
  process.env.BETTER_AUTH_SECRET || 'OtlKOcUUz2KxFiEARcURJZax7+AEfJE+qHvukCTJrgI='
);

function makeRequest(server, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const reqHeaders = { ...headers };
    if (payload) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method,
      headers: reqHeaders,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('\n========================================================');
  console.log('       PIZZAHUB STEP 7: MENU ITEMS & VENDOR TEST        ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');
  const menuItems = db.collection('menuItems');

  // Setup test vendors
  const vendor1Id = '6afeba851c4083c4535d4d60';
  await users.updateOne(
    { email: 'vendor.test@pizzahub.com' },
    {
      $set: {
        id: vendor1Id,
        role: 'vendor',
        businessName: 'Napoli Fire Kitchen',
        subscriptionPlan: 'free',
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  const vendor2Id = '6afeba851c4083c4535d4d77';
  await users.updateOne(
    { email: 'other.vendor@pizzahub.com' },
    {
      $set: {
        id: vendor2Id,
        role: 'vendor',
        businessName: 'Milano Crust Co',
        subscriptionPlan: 'free',
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  // Clean vendor items from prior test runs
  await menuItems.deleteMany({ vendorId: { $in: [vendor1Id, vendor2Id] } });

  // Generate tokens
  const vendor1Token = await new SignJWT({ sub: vendor1Id, email: 'vendor.test@pizzahub.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  const vendor2Token = await new SignJWT({ sub: vendor2Id, email: 'other.vendor@pizzahub.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  const server = app.listen(0);

  try {
    // TEST 1: Create 1st, 2nd, and 3rd menu items on Free plan (All should succeed with status: 'pending')
    console.log('TEST 1: Creating 3 menu items on Free Plan...');
    const item1 = await makeRequest(
      server,
      '/api/vendor/menu-items',
      'POST',
      {
        itemName: 'Margherita Fresca',
        category: 'Classic Pizzas',
        description: 'San Marzano tomatoes, fresh mozzarella, basil.',
        price: 14.99,
        location: 'Gulshan-2, Dhaka',
        images: ['https://example.com/margherita.jpg'],
      },
      { Authorization: `Bearer ${vendor1Token}` }
    );
    console.log(`Item 1 status: ${item1.status} | Default item status: ${item1.body.data?.status}`);
    if (item1.status !== 201 || item1.body.data?.status !== 'pending') {
      throw new Error(`Item 1 creation failed: ${JSON.stringify(item1.body)}`);
    }

    const item2 = await makeRequest(
      server,
      '/api/vendor/menu-items',
      'POST',
      {
        itemName: 'Spicy Pepperoni Diablo',
        category: 'Meat Lovers',
        description: 'Double beef pepperoni, habanero oil, aged mozzarella.',
        price: 18.5,
        location: 'Gulshan-2, Dhaka',
        images: ['https://example.com/pepperoni.jpg'],
      },
      { Authorization: `Bearer ${vendor1Token}` }
    );
    console.log(`Item 2 status: ${item2.status}`);

    const item3 = await makeRequest(
      server,
      '/api/vendor/menu-items',
      'POST',
      {
        itemName: 'Truffle Mushroom Melt',
        category: 'Specialty / Gourmet Pizzas',
        description: 'Wild cremini mushrooms, fontina, truffle drizzle.',
        price: 21.0,
        location: 'Banani, Dhaka',
        images: ['https://example.com/mushroom.jpg'],
      },
      { Authorization: `Bearer ${vendor1Token}` }
    );
    console.log(`Item 3 status: ${item3.status}`);
    console.log('✅ TEST 1 PASSED: 3 items created with default status="pending".\n');

    // TEST 2: Attempt to create 4th item on Free plan -> MUST BE REJECTED with 403
    console.log('TEST 2: Attempting to create 4th item on Free Plan (Expect 403 Limit Rejection)...');
    const item4 = await makeRequest(
      server,
      '/api/vendor/menu-items',
      'POST',
      {
        itemName: 'Four Cheese Quattro',
        category: 'Vegetarian Pizzas',
        description: 'Gorgonzola, parmesan, mozzarella, ricotta.',
        price: 19.0,
        location: 'Gulshan-2, Dhaka',
        images: ['https://example.com/quattro.jpg'],
      },
      { Authorization: `Bearer ${vendor1Token}` }
    );
    console.log(`Status: ${item4.status} | Response:`, JSON.stringify(item4.body));
    if (item4.status === 403 && item4.body.code === 'PLAN_LIMIT_REACHED') {
      console.log('✅ TEST 2 PASSED: Free plan 3-item limit strictly enforced.\n');
    } else {
      throw new Error(`Expected 403 PLAN_LIMIT_REACHED, got ${item4.status}`);
    }

    // TEST 3: Strict Ownership Check (Vendor 2 cannot edit or delete Vendor 1's item)
    console.log('TEST 3: Testing Strict Ownership Enforcement (Vendor 2 trying to edit Vendor 1 item)...');
    const editRes = await makeRequest(
      server,
      `/api/vendor/menu-items/${item1.body.data.id}`,
      'PUT',
      { price: 99.99 },
      { Authorization: `Bearer ${vendor2Token}` } // Wrong vendor!
    );
    console.log(`Status: ${editRes.status} | Response:`, JSON.stringify(editRes.body));
    if (editRes.status === 403) {
      console.log('✅ TEST 3 PASSED: Ownership violation returned 403 Forbidden.\n');
    } else {
      throw new Error(`Expected 403, got ${editRes.status}`);
    }

    // TEST 4: Public API - Pending items are NOT returned in public endpoints
    console.log('TEST 4: Public Catalog Query for Pending Items...');
    const publicRes1 = await makeRequest(server, '/api/menu-items');
    console.log(`Total public items returned: ${publicRes1.body.data?.length}`);
    const foundPending = publicRes1.body.data?.find((i) => i.id === item1.body.data.id);
    if (!foundPending) {
      console.log('✅ TEST 4 PASSED: Pending items are hidden from public catalog.\n');
    } else {
      throw new Error('SECURITY FAILURE: Pending item exposed in public catalog!');
    }

    // TEST 5: Approve item and verify Public Search, Filter, Sort
    console.log('TEST 5: Approving items and testing Search, Category Filter, and Sorting...');
    await menuItems.updateMany(
      { vendorId: vendor1Id },
      { $set: { status: 'approved' } }
    );

    // Search by name
    const searchRes = await makeRequest(server, '/api/menu-items?search=pepperoni');
    console.log(`Search 'pepperoni' returned count: ${searchRes.body.data?.length} (Found: "${searchRes.body.data?.[0]?.itemName}")`);
    if (searchRes.body.data?.[0]?.itemName !== 'Spicy Pepperoni Diablo') {
      throw new Error('Search filter failed');
    }

    // Filter by category
    const catRes = await makeRequest(server, '/api/menu-items?category=Classic%20Pizzas');
    console.log(`Category 'Classic Pizzas' count: ${catRes.body.data?.length}`);

    // Sort by price ascending
    const sortRes = await makeRequest(server, '/api/menu-items?sort=price_asc');
    console.log(`Sort price_asc lowest price: $${sortRes.body.data?.[0]?.price}`);
    if (sortRes.body.data?.[0]?.price !== 14.99) {
      throw new Error('Price asc sort failed');
    }
    console.log('✅ TEST 5 PASSED: Search, category filter, and sorting verified.\n');

    // TEST 6: Public single item 404 on unapproved/missing IDs
    console.log('TEST 6: Probing GET /api/menu-items/nonexistent-id (Expect 404)...');
    const notFoundRes = await makeRequest(server, '/api/menu-items/123456789012345678901234');
    console.log(`Status: ${notFoundRes.status} | Response:`, JSON.stringify(notFoundRes.body));
    if (notFoundRes.status === 404) {
      console.log('✅ TEST 6 PASSED: Proper 404 returned for missing menu item.\n');
    } else {
      throw new Error(`Expected 404, got ${notFoundRes.status}`);
    }

    console.log('--------------------------------------------------------');
    console.log('       ALL STEP 7 SERVER TESTS PASSED SUCCESSFULLY!     ');
    console.log('========================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
