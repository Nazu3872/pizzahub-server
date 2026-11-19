const { SignJWT } = require('jose');
const http = require('http');
const dns = require('dns');

if (process.platform === 'win32') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  } catch (e) {}
}

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

async function createToken(userId, email, role) {
  return await new SignJWT({
    sub: userId,
    id: userId,
    email: email,
    role: role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);
}

async function runTests() {
  console.log('\n========================================================');
  console.log('       PIZZAHUB STEP 9: ORDER SYSTEM AUTOMATED SUITE    ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');
  const menuItems = db.collection('menuItems');
  const orders = db.collection('orders');

  // Setup test users: 2 Customers, 2 Vendors, 1 Admin
  const cust1Id = '6afeba851c4083c4535d4c01';
  const cust2Id = '6afeba851c4083c4535d4c02';
  const vendor1Id = '6afeba851c4083c4535d4v01';
  const vendor2Id = '6afeba851c4083c4535d4v02';
  const adminId = '6afeba851c4083c4535d4a01';

  await users.updateOne(
    { email: 'cust1.test@pizzahub.com' },
    { $set: { id: cust1Id, name: 'Alice Customer', role: 'customer', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'cust2.test@pizzahub.com' },
    { $set: { id: cust2Id, name: 'Bob Customer', role: 'customer', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'vendor1.test@pizzahub.com' },
    { $set: { id: vendor1Id, name: 'Luigi Chef', businessName: 'Luigi Gourmet Pizza', role: 'vendor', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'vendor2.test@pizzahub.com' },
    { $set: { id: vendor2Id, name: 'Mario Chef', businessName: 'Mario Brick Oven', role: 'vendor', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'admin.test@pizzahub.com' },
    { $set: { id: adminId, name: 'Super Admin', role: 'admin', isBlocked: false } },
    { upsert: true }
  );

  // Setup test menu items: 1 approved item for Vendor 1
  await menuItems.deleteMany({ itemName: /^TEST_/ });
  const testItemInsert = await menuItems.insertOne({
    vendorId: vendor1Id,
    itemName: 'TEST_Artisan Truffle Pizza',
    category: 'Specialty / Gourmet Pizzas',
    description: 'Black truffle cream, mozzarella, and cremini mushrooms',
    price: 24.50,
    location: 'Gulshan 2, Dhaka',
    images: ['https://images.unsplash.com/photo-1513104890138-7c749659a591'],
    status: 'approved',
    isActive: true,
    createdAt: new Date(),
  });
  const testItemId = testItemInsert.insertedId.toString();

  // Clear past test orders
  await orders.deleteMany({ itemId: testItemId });

  // Generate tokens
  const tokenCust1 = await createToken(cust1Id, 'cust1.test@pizzahub.com', 'customer');
  const tokenCust2 = await createToken(cust2Id, 'cust2.test@pizzahub.com', 'customer');
  const tokenVendor1 = await createToken(vendor1Id, 'vendor1.test@pizzahub.com', 'vendor');
  const tokenVendor2 = await createToken(vendor2Id, 'vendor2.test@pizzahub.com', 'vendor');
  const tokenAdmin = await createToken(adminId, 'admin.test@pizzahub.com', 'admin');

  // Start HTTP server on random port
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
    }
  }

  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // TEST 1: Customer 1 creates an order successfully
    const res1 = await makeRequest(server, '/api/orders', 'POST', {
      itemId: testItemId,
      deliveryDate: tomorrowStr,
      deliveryAddress: 'House 14, Road 11, Banani, Dhaka',
      message: 'Please bring hot and extra napkins',
    }, { Authorization: `Bearer ${tokenCust1}` });

    assert(res1.status === 201 && res1.body.success && res1.body.data.status === 'pending',
      'Test 1: Customer creates order with valid details -> 201 Created (status: pending)');
    const order1Id = res1.body?.data?.orderId;

    // TEST 2: Past delivery date is rejected
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 2);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const res2 = await makeRequest(server, '/api/orders', 'POST', {
      itemId: testItemId,
      deliveryDate: yesterdayStr,
      deliveryAddress: 'House 14, Road 11, Banani, Dhaka',
    }, { Authorization: `Bearer ${tokenCust1}` });

    assert(res2.status === 400 && res2.body.message.includes('past'),
      'Test 2: Order with deliveryDate in the past -> 400 Bad Request');

    // TEST 3: Duplicate ACTIVE order for same customer + same item + same date is rejected
    const res3 = await makeRequest(server, '/api/orders', 'POST', {
      itemId: testItemId,
      deliveryDate: tomorrowStr,
      deliveryAddress: 'Different address same day',
    }, { Authorization: `Bearer ${tokenCust1}` });

    assert(res3.status === 400 && res3.body.message.includes('already have an active order'),
      'Test 3: Duplicate active order on same item + date by same customer -> 400 Bad Request');

    // TEST 4: Admin cannot order (role must be customer)
    const res4 = await makeRequest(server, '/api/orders', 'POST', {
      itemId: testItemId,
      deliveryDate: tomorrowStr,
      deliveryAddress: 'Secret Bunker, Dhaka',
    }, { Authorization: `Bearer ${tokenAdmin}` });

    assert(res4.status === 403,
      'Test 4: Admin account attempts to order -> 403 Forbidden');

    // TEST 5: Cross-vendor tampering: Vendor 2 cannot accept Vendor 1's order
    const res5 = await makeRequest(server, `/api/orders/${order1Id}/accept`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenVendor2}`,
    });

    assert(res5.status === 403,
      'Test 5: Unauthorized Vendor 2 attempts to accept Vendor 1\'s order -> 403 Forbidden');

    // TEST 6: Vendor 1 accepts Customer 1's order
    const res6 = await makeRequest(server, `/api/orders/${order1Id}/accept`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenVendor1}`,
    });

    assert(res6.status === 200 && res6.body.data.status === 'accepted',
      'Test 6: Valid Vendor 1 accepts pending order -> 200 OK (status: accepted)');

    // TEST 7: Vendor cannot accept an already accepted order again
    const res7 = await makeRequest(server, `/api/orders/${order1Id}/accept`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenVendor1}`,
    });

    assert(res7.status === 400 && res7.body.message.includes('Only pending'),
      'Test 7: Vendor attempts to re-accept an accepted order -> 400 Bad Request');

    // TEST 8: Customer 1 cannot cancel an accepted order
    const res8 = await makeRequest(server, `/api/orders/${order1Id}/cancel`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenCust1}`,
    });

    assert(res8.status === 400 && res8.body.message.includes('Only pending'),
      'Test 8: Customer attempts to cancel an accepted order -> 400 Bad Request');

    // TEST 9: Customer 2 places an order for same item next week
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];

    const res9 = await makeRequest(server, '/api/orders', 'POST', {
      itemId: testItemId,
      deliveryDate: nextWeekStr,
      deliveryAddress: 'Apartment 4B, Dhanmondi, Dhaka',
    }, { Authorization: `Bearer ${tokenCust2}` });

    assert(res9.status === 201 && res9.body.data.status === 'pending',
      'Test 9: Customer 2 places independent pending order -> 201 Created');
    const order2Id = res9.body?.data?.orderId;

    // TEST 10: Cross-customer tampering: Customer 1 attempts to cancel Customer 2's order
    const res10 = await makeRequest(server, `/api/orders/${order2Id}/cancel`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenCust1}`,
    });

    assert(res10.status === 403,
      'Test 10: Customer 1 attempts to cancel Customer 2\'s order -> 403 Forbidden');

    // TEST 11: Customer 2 cancels own pending order
    const res11 = await makeRequest(server, `/api/orders/${order2Id}/cancel`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenCust2}`,
    });

    assert(res11.status === 200 && res11.body.data.status === 'cancelled',
      'Test 11: Customer 2 cancels own pending order -> 200 OK (status: cancelled)');

    // TEST 12: Customer 2 cannot cancel an already cancelled order
    const res12 = await makeRequest(server, `/api/orders/${order2Id}/cancel`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenCust2}`,
    });

    assert(res12.status === 400 && res12.body.message.includes('Only pending'),
      'Test 12: Customer 2 attempts to cancel already cancelled order -> 400 Bad Request');

    // TEST 13: Vendor 1 lists incoming orders with enrichment
    const res13 = await makeRequest(server, '/api/orders/vendor', 'GET', null, {
      Authorization: `Bearer ${tokenVendor1}`,
    });

    assert(res13.status === 200 && res13.body.data.length >= 2 && res13.body.data[0].customer.name,
      'Test 13: Vendor lists incoming orders with customer & item info enriched -> 200 OK');

    // TEST 14: Customer 1 lists own orders with enrichment
    const res14 = await makeRequest(server, '/api/orders/customer', 'GET', null, {
      Authorization: `Bearer ${tokenCust1}`,
    });

    assert(res14.status === 200 && res14.body.data.length >= 1 && res14.body.data[0].vendor.businessName,
      'Test 14: Customer lists own orders with vendor & item info enriched -> 200 OK');

    // TEST 15: Get order details by ID: customer, vendor, admin have access; foreign customer does not
    const res15a = await makeRequest(server, `/api/orders/${order1Id}`, 'GET', null, {
      Authorization: `Bearer ${tokenCust1}`,
    });
    const res15b = await makeRequest(server, `/api/orders/${order1Id}`, 'GET', null, {
      Authorization: `Bearer ${tokenCust2}`, // Unauthorized customer
    });
    const res15c = await makeRequest(server, `/api/orders/${order1Id}`, 'GET', null, {
      Authorization: `Bearer ${tokenAdmin}`, // Admin view
    });

    assert(res15a.status === 200 && res15b.status === 403 && res15c.status === 200,
      'Test 15: Single order view: Owner allowed (200), Admin allowed (200), Foreign customer blocked (403)');

  } finally {
    // Cleanup test items and test orders
    await menuItems.deleteMany({ itemName: /^TEST_/ });
    await orders.deleteMany({ itemId: testItemId });
    server.close();
  }

  console.log(`\nResults: ${passed}/${total} tests passed.\n`);
  if (passed !== total) {
    process.exit(1);
  }
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
