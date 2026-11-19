const { SignJWT } = require('jose');
const { MongoClient } = require('mongodb');
const http = require('http');
const app = require('../src/app');
const { connectDB, getDB } = require('../src/db/connection');
const config = require('../src/config/env');

const secretKey = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET || 'OtlKOcUUz2KxFiEARcURJZax7+AEfJE+qHvukCTJrgI=');

function makeRequest(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET',
      headers,
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
    req.end();
  });
}

async function runTests() {
  console.log('\n========================================================');
  console.log('       PIZZAHUB STEP 6: REAL JWT SECURITY SUITE         ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');

  // Find or create test customer, vendor, and blocked user in DB
  let customer = await users.findOne({ email: 'customer.test@pizzahub.com' });
  if (!customer) {
    const res = await users.insertOne({
      name: 'Customer Tester',
      email: 'customer.test@pizzahub.com',
      role: 'customer',
      isBlocked: false,
      createdAt: new Date(),
    });
    customer = { _id: res.insertedId, id: res.insertedId.toString(), role: 'customer' };
  }

  let vendor = await users.findOne({ email: 'vendor.test@pizzahub.com' });
  if (!vendor) {
    const res = await users.insertOne({
      name: 'Vendor Tester',
      email: 'vendor.test@pizzahub.com',
      role: 'vendor',
      businessName: 'Oven Pizza Co',
      isBlocked: false,
      createdAt: new Date(),
    });
    vendor = { _id: res.insertedId, id: res.insertedId.toString(), role: 'vendor' };
  }

  let blockedUser = await users.findOne({ email: 'blocked.test@pizzahub.com' });
  if (!blockedUser) {
    const res = await users.insertOne({
      name: 'Suspended Tester',
      email: 'blocked.test@pizzahub.com',
      role: 'customer',
      isBlocked: true, // Blocked user
      createdAt: new Date(),
    });
    blockedUser = { _id: res.insertedId, id: res.insertedId.toString(), role: 'customer', isBlocked: true };
  } else {
    await users.updateOne({ email: 'blocked.test@pizzahub.com' }, { $set: { isBlocked: true } });
  }

  // Generate tokens
  const customerToken = await new SignJWT({
    sub: customer.id || customer._id.toString(),
    email: customer.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  const vendorToken = await new SignJWT({
    sub: vendor.id || vendor._id.toString(),
    email: vendor.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  const expiredToken = await new SignJWT({
    sub: customer.id || customer._id.toString(),
    email: customer.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 10) // expired
    .sign(secretKey);

  const blockedToken = await new SignJWT({
    sub: blockedUser.id || blockedUser._id.toString(),
    email: blockedUser.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretKey);

  // Start local ephemeral HTTP server
  const server = app.listen(0);

  try {
    // CASE 1: No Token (401)
    console.log('CASE 1: Probing GET /api/me with NO token...');
    const res1 = await makeRequest(server, '/api/me');
    console.log(`Status: ${res1.status} | Response:`, JSON.stringify(res1.body));
    if (res1.status === 401) console.log('✅ CASE 1 PASSED: Correctly returned 401 Unauthorized for missing token.\n');
    else throw new Error(`Expected 401, got ${res1.status}`);

    // CASE 2: Garbage Token (401)
    console.log('CASE 2: Probing GET /api/me with GARBAGE token...');
    const res2 = await makeRequest(server, '/api/me', {
      Authorization: 'Bearer invalid.garbage.jwt.token',
    });
    console.log(`Status: ${res2.status} | Response:`, JSON.stringify(res2.body));
    if (res2.status === 401) console.log('✅ CASE 2 PASSED: Correctly returned 401 Unauthorized for malformed token.\n');
    else throw new Error(`Expected 401, got ${res2.status}`);

    // CASE 3: Expired Token (401)
    console.log('CASE 3: Probing GET /api/me with EXPIRED token...');
    const res3 = await makeRequest(server, '/api/me', {
      Authorization: `Bearer ${expiredToken}`,
    });
    console.log(`Status: ${res3.status} | Response:`, JSON.stringify(res3.body));
    if (res3.status === 401) console.log('✅ CASE 3 PASSED: Correctly returned 401 Unauthorized for expired token.\n');
    else throw new Error(`Expected 401, got ${res3.status}`);

    // CASE 4: Customer Token on Vendor-Only Route (403)
    console.log('CASE 4: Probing GET /api/test/vendor-only with CUSTOMER token...');
    const res4 = await makeRequest(server, '/api/test/vendor-only', {
      Authorization: `Bearer ${customerToken}`,
    });
    console.log(`Status: ${res4.status} | Response:`, JSON.stringify(res4.body));
    if (res4.status === 403) console.log('✅ CASE 4 PASSED: Correctly returned 403 Forbidden for unauthorized role.\n');
    else throw new Error(`Expected 403, got ${res4.status}`);

    // CASE 5: Blocked User Token (403)
    console.log('CASE 5: Probing GET /api/me with BLOCKED user token...');
    const res5 = await makeRequest(server, '/api/me', {
      Authorization: `Bearer ${blockedToken}`,
    });
    console.log(`Status: ${res5.status} | Response:`, JSON.stringify(res5.body));
    if (res5.status === 403) console.log('✅ CASE 5 PASSED: Correctly returned 403 Forbidden for suspended user.\n');
    else throw new Error(`Expected 403, got ${res5.status}`);

    // CASE 6: Valid Vendor Token on Vendor Route (200)
    console.log('CASE 6: Probing GET /api/test/vendor-only with VALID VENDOR token...');
    const res6 = await makeRequest(server, '/api/test/vendor-only', {
      Authorization: `Bearer ${vendorToken}`,
    });
    console.log(`Status: ${res6.status} | Response:`, JSON.stringify(res6.body));
    if (res6.status === 200) console.log('✅ CASE 6 PASSED: Correctly returned 200 OK for authorized vendor.\n');
    else throw new Error(`Expected 200, got ${res6.status}`);

    console.log('--------------------------------------------------------');
    console.log('   ALL 6 JWT SECURITY & ROLE TEST CASES PASSED!         ');
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
