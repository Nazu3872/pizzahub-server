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
  console.log('       PIZZAHUB STEP 11: ADMIN CONTROLS TEST SUITE      ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');
  const menuItems = db.collection('menuItems');

  // Test accounts
  const admin1Id = '6afeba851c4083c4535d4ad1';
  const admin2Id = '6afeba851c4083c4535d4ad2';
  const vendorId = '6afeba851c4083c4535d4vd1';
  const customerId = '6afeba851c4083c4535d4cd1';

  await users.updateOne(
    { email: 'admin1.test@pizzahub.com' },
    { $set: { id: admin1Id, name: 'Lead Admin', role: 'admin', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'admin2.test@pizzahub.com' },
    { $set: { id: admin2Id, name: 'Second Admin', role: 'admin', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'vendor.mod@pizzahub.com' },
    { $set: { id: vendorId, name: 'Mod Chef', businessName: 'Mod Crust', role: 'vendor', isBlocked: false } },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'customer.mod@pizzahub.com' },
    { $set: { id: customerId, name: 'Customer Mod', role: 'customer', isBlocked: false } },
    { upsert: true }
  );

  const tokenAdmin1 = await createToken(admin1Id, 'admin1.test@pizzahub.com', 'admin');
  const tokenVendor = await createToken(vendorId, 'vendor.mod@pizzahub.com', 'vendor');
  const tokenCustomer = await createToken(customerId, 'customer.mod@pizzahub.com', 'customer');

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
    // ------------------------------------------------------------------------
    // TEST 1: Non-admin gets 403 on every admin route
    // ------------------------------------------------------------------------
    const res1a = await makeRequest(server, '/api/admin/stats', 'GET', null, {
      Authorization: `Bearer ${tokenCustomer}`,
    });
    const res1b = await makeRequest(server, '/api/admin/users', 'GET', null, {
      Authorization: `Bearer ${tokenCustomer}`,
    });
    const res1c = await makeRequest(server, `/api/admin/users/${vendorId}/block`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenCustomer}`,
    });
    const res1d = await makeRequest(server, '/api/admin/menu-items', 'GET', null, {
      Authorization: `Bearer ${tokenVendor}`,
    });

    assert(
      res1a.status === 403 && res1b.status === 403 && res1c.status === 403 && res1d.status === 403,
      'Test 1: Non-admin (Customer & Vendor) accounts receive 403 Forbidden on all admin endpoints'
    );

    // ------------------------------------------------------------------------
    // TEST 2: Admin accesses platform overview stats
    // ------------------------------------------------------------------------
    const res2 = await makeRequest(server, '/api/admin/stats', 'GET', null, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res2.status === 200 &&
        res2.body.data.totalUsers >= 3 &&
        typeof res2.body.data.totalRevenue === 'number',
      'Test 2: Admin retrieves aggregated platform metrics (totalUsers, totalRevenue, totalMenuItems) -> 200 OK'
    );

    // ------------------------------------------------------------------------
    // TEST 3: Admin lists users with search
    // ------------------------------------------------------------------------
    const res3 = await makeRequest(server, '/api/admin/users?search=Mod', 'GET', null, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res3.status === 200 && res3.body.data.length >= 1 && res3.body.data[0].email.includes('mod'),
      'Test 3: Admin searches users by keyword -> 200 OK with filtered results'
    );

    // ------------------------------------------------------------------------
    // TEST 4: Admin cannot block their own account
    // ------------------------------------------------------------------------
    const res4 = await makeRequest(server, `/api/admin/users/${admin1Id}/block`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res4.status === 400 && res4.body.message.includes('own account'),
      'Test 4: Admin cannot block themselves -> 400 Bad Request'
    );

    // ------------------------------------------------------------------------
    // TEST 5: Admin cannot block other admins
    // ------------------------------------------------------------------------
    const res5 = await makeRequest(server, `/api/admin/users/${admin2Id}/block`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res5.status === 403 && res5.body.message.includes('other administrator'),
      'Test 5: Admin cannot block another administrator account -> 403 Forbidden'
    );

    // ------------------------------------------------------------------------
    // TEST 6: Admin blocks a vendor account
    // ------------------------------------------------------------------------
    const res6 = await makeRequest(server, `/api/admin/users/${vendorId}/block`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res6.status === 200 && res6.body.data.isBlocked === true,
      'Test 6: Admin blocks vendor account -> 200 OK'
    );

    // ------------------------------------------------------------------------
    // TEST 7: Block takes effect IMMEDIATELY on all protected APIs
    // ------------------------------------------------------------------------
    const res7 = await makeRequest(server, '/api/me', 'GET', null, {
      Authorization: `Bearer ${tokenVendor}`,
    });
    assert(
      res7.status === 403 && res7.body.message.includes('suspended'),
      'Test 7: Blocked vendor is immediately cut off from protected API routes -> 403 Forbidden'
    );

    // ------------------------------------------------------------------------
    // TEST 8: Admin unblocks vendor account
    // ------------------------------------------------------------------------
    const res8 = await makeRequest(server, `/api/admin/users/${vendorId}/unblock`, 'PATCH', {}, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res8.status === 200 && res8.body.data.isBlocked === false,
      'Test 8: Admin unblocks vendor account -> 200 OK'
    );

    const res8b = await makeRequest(server, '/api/me', 'GET', null, {
      Authorization: `Bearer ${tokenVendor}`,
    });
    assert(
      res8b.status === 200 && (res8b.body.user?.email === 'vendor.mod@pizzahub.com' || res8b.body.data?.email === 'vendor.mod@pizzahub.com'),
      'Test 9: Unblocked vendor access is immediately restored -> 200 OK'
    );

    // ------------------------------------------------------------------------
    // TEST 10: Menu Item Moderation: approve pending item alters public browse
    // ------------------------------------------------------------------------
    // Create a pending item directly
    const testItem = await menuItems.insertOne({
      vendorId: vendorId,
      itemName: 'TEST_Moderation_Pizza_Admin',
      category: 'Specialty / Gourmet Pizzas',
      description: 'Pending moderation test pizza',
      price: 26.00,
      location: 'Banani, Dhaka',
      images: ['https://images.unsplash.com/photo-1513104890138-7c749659a591'],
      status: 'pending',
      isActive: false,
      createdAt: new Date(),
    });
    const testItemId = testItem.insertedId.toString();

    // Verify item is NOT in public browse
    const res10a = await makeRequest(server, '/api/menu-items?search=TEST_Moderation_Pizza_Admin', 'GET');
    assert(
      res10a.status === 200 && res10a.body.data.length === 0,
      'Test 10a: Pending menu item is strictly hidden from public Browse page -> 0 items returned'
    );

    // Admin approves the item
    const res10b = await makeRequest(server, `/api/admin/menu-items/${testItemId}/status`, 'PATCH', {
      status: 'approved',
    }, { Authorization: `Bearer ${tokenAdmin1}` });

    assert(
      res10b.status === 200 && res10b.body.data.status === 'approved',
      'Test 10b: Admin approves pending menu item -> 200 OK'
    );

    // Public browse now includes it!
    const res10c = await makeRequest(server, '/api/menu-items?search=TEST_Moderation_Pizza_Admin', 'GET');
    assert(
      res10c.status === 200 && res10c.body.data.length === 1 && res10c.body.data[0].itemName === 'TEST_Moderation_Pizza_Admin',
      'Test 10c: Newly approved item is now visible on public Browse page -> 1 item returned'
    );

    // ------------------------------------------------------------------------
    // TEST 11: Admin deletes menu item permanently
    // ------------------------------------------------------------------------
    const res11 = await makeRequest(server, `/api/admin/menu-items/${testItemId}`, 'DELETE', null, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res11.status === 200 && res11.body.success,
      'Test 11: Admin deletes inappropriate item -> 200 OK'
    );

    const res11b = await makeRequest(server, '/api/menu-items?search=TEST_Moderation_Pizza_Admin', 'GET');
    assert(
      res11b.status === 200 && res11b.body.data.length === 0,
      'Test 12: Deleted item no longer visible on public Browse page -> 0 items returned'
    );

    // ------------------------------------------------------------------------
    // TEST 13: Admin transactions is read-only GET (no PUT/PATCH/DELETE)
    // ------------------------------------------------------------------------
    const res13a = await makeRequest(server, '/api/admin/transactions', 'GET', null, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res13a.status === 200 && Array.isArray(res13a.body.data),
      'Test 13: Admin retrieves read-only transaction list -> 200 OK'
    );

    const res13b = await makeRequest(server, '/api/admin/transactions', 'DELETE', null, {
      Authorization: `Bearer ${tokenAdmin1}`,
    });
    assert(
      res13b.status === 404 || res13b.status === 405,
      'Test 14: Non-existent DELETE on transactions returns 404/405 (No mutating routes exist)'
    );

  } finally {
    // Cleanup test items and accounts
    await menuItems.deleteMany({ itemName: /^TEST_/ });
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
