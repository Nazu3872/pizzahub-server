const { SignJWT } = require('jose');
const http = require('http');
const dns = require('dns');
const Stripe = require('stripe');

if (process.platform === 'win32') {
  try {
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
  } catch (e) {}
}

const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_suite_testing_12345';
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;

const app = require('../src/app');
const { connectDB, getDB } = require('../src/db/connection');

const secretKey = new TextEncoder().encode(
  process.env.BETTER_AUTH_SECRET || 'OtlKOcUUz2KxFiEARcURJZax7+AEfJE+qHvukCTJrgI='
);

const testStripe = new Stripe('sk_test_placeholder', { apiVersion: '2023-10-16' });

function makeRequest(server, path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const payload =
      body !== null
        ? Buffer.isBuffer(body)
          ? body
          : typeof body === 'string'
          ? Buffer.from(body)
          : Buffer.from(JSON.stringify(body))
        : null;

    const reqHeaders = { ...headers };
    if (payload && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (payload) {
      reqHeaders['Content-Length'] = payload.length;
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
  console.log('       PIZZAHUB STEP 10: STRIPE & WEBHOOK TEST SUITE    ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');
  const transactions = db.collection('transactions');

  // Setup test users: 1 Free Vendor, 1 Customer, 1 Admin
  const vendorId = '6afeba851c4083c4535d4991';
  const customerId = '6afeba851c4083c4535d4992';
  const adminId = '6afeba851c4083c4535d4993';

  await users.updateOne(
    { email: 'vendor.stripe@pizzahub.com' },
    {
      $set: {
        id: vendorId,
        name: 'Stripe Chef',
        businessName: 'Stripe Artisan Pizza',
        role: 'vendor',
        subscriptionPlan: 'free',
        subscriptionExpiresAt: null,
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'cust.stripe@pizzahub.com' },
    {
      $set: {
        id: customerId,
        name: 'Stripe Customer',
        role: 'customer',
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  await users.updateOne(
    { email: 'admin.stripe@pizzahub.com' },
    {
      $set: {
        id: adminId,
        name: 'Stripe Admin',
        role: 'admin',
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  const tokenVendor = await createToken(vendorId, 'vendor.stripe@pizzahub.com', 'vendor');
  const tokenCustomer = await createToken(customerId, 'cust.stripe@pizzahub.com', 'customer');
  const tokenAdmin = await createToken(adminId, 'admin.stripe@pizzahub.com', 'admin');

  // Start HTTP server
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
    // TEST 1: Webhook rejects request without signature
    // ------------------------------------------------------------------------
    const res1 = await makeRequest(server, '/api/stripe/webhook', 'POST', { test: true });
    assert(res1.status === 400, 'Test 1: Webhook without stripe-signature header returns 400 Bad Request');

    // ------------------------------------------------------------------------
    // TEST 2: Webhook rejects request with invalid signature
    // ------------------------------------------------------------------------
    const res2 = await makeRequest(
      server,
      '/api/stripe/webhook',
      'POST',
      JSON.stringify({ test: true }),
      {
        'stripe-signature': 't=12345,v1=garbage_signature_value',
        'Content-Type': 'application/json',
      }
    );
    assert(res2.status === 400, 'Test 2: Webhook with invalid signature returns 400 Bad Request');

    // ------------------------------------------------------------------------
    // TEST 3: checkout.session.completed signed event upgrades vendor & creates transaction
    // ------------------------------------------------------------------------
    const testSessionId = `cs_test_pizzahub_${Date.now()}`;
    const testSubId = `sub_test_pizzahub_${Date.now()}`;
    const checkoutEvent = {
      id: `evt_test_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: testSessionId,
          object: 'checkout.session',
          client_reference_id: vendorId,
          customer_email: 'vendor.stripe@pizzahub.com',
          amount_total: 2900,
          currency: 'usd',
          subscription: testSubId,
          metadata: {
            vendorId: vendorId,
          },
        },
      },
    };

    const checkoutPayload = JSON.stringify(checkoutEvent);
    const validSignature = testStripe.webhooks.generateTestHeaderString({
      payload: checkoutPayload,
      secret: TEST_WEBHOOK_SECRET,
    });

    const res3 = await makeRequest(
      server,
      '/api/stripe/webhook',
      'POST',
      checkoutPayload,
      {
        'stripe-signature': validSignature,
        'Content-Type': 'application/json',
      }
    );

    assert(res3.status === 200 && res3.body.received === true,
      'Test 3: Webhook accepts validly signed checkout.session.completed -> 200 OK');

    // Verify vendor upgraded in database
    const upgradedVendor = await users.findOne({ id: vendorId });
    assert(
      upgradedVendor && upgradedVendor.subscriptionPlan === 'premium' && upgradedVendor.subscriptionExpiresAt,
      'Test 4: Vendor document in MongoDB updated: subscriptionPlan = "premium" with future expiry date'
    );

    // Verify transaction document saved
    const savedTx = await transactions.findOne({ stripeSessionId: testSessionId });
    assert(
      savedTx && savedTx.vendorId === vendorId && savedTx.status === 'completed' && savedTx.amount === 29,
      'Test 5: Transaction document recorded in transactions collection with amount $29.00'
    );

    // ------------------------------------------------------------------------
    // TEST 6: Webhook IDEMPOTENCY: Replaying exact same event is harmless
    // ------------------------------------------------------------------------
    const res6 = await makeRequest(
      server,
      '/api/stripe/webhook',
      'POST',
      checkoutPayload,
      {
        'stripe-signature': validSignature,
        'Content-Type': 'application/json',
      }
    );

    assert(res6.status === 200 && res6.body.duplicate === true,
      'Test 6: Replaying identical webhook event is idempotent (duplicate: true, no error) -> 200 OK');

    const txCount = await transactions.countDocuments({ stripeSessionId: testSessionId });
    assert(txCount === 1, 'Test 7: No duplicate transaction created in database');

    // ------------------------------------------------------------------------
    // TEST 8: GET /api/subscription/status returns updated Premium status
    // ------------------------------------------------------------------------
    const res8 = await makeRequest(server, '/api/subscription/status', 'GET', null, {
      Authorization: `Bearer ${tokenVendor}`,
    });
    assert(res8.status === 200 && res8.body.data.isPremium === true && res8.body.data.subscriptionPlan === 'premium',
      'Test 8: GET /api/subscription/status confirms vendor is now Premium in real-time');

    // ------------------------------------------------------------------------
    // TEST 9: POST /api/subscription/checkout rejects if already Premium
    // ------------------------------------------------------------------------
    const res9 = await makeRequest(server, '/api/subscription/checkout', 'POST', {}, {
      Authorization: `Bearer ${tokenVendor}`,
    });
    assert(res9.status === 400 && res9.body.message.includes('already subscribed'),
      'Test 9: Premium vendor attempting new checkout is rejected -> 400 Bad Request');

    // ------------------------------------------------------------------------
    // TEST 10: Non-vendor (Customer) cannot create subscription checkout
    // ------------------------------------------------------------------------
    const res10 = await makeRequest(server, '/api/subscription/checkout', 'POST', {}, {
      Authorization: `Bearer ${tokenCustomer}`,
    });
    assert(res10.status === 403,
      'Test 10: Customer account attempting subscription checkout is forbidden -> 403');

    // ------------------------------------------------------------------------
    // TEST 11: Admin can inspect transactions (GET only)
    // ------------------------------------------------------------------------
    const res11 = await makeRequest(server, '/api/admin/transactions', 'GET', null, {
      Authorization: `Bearer ${tokenAdmin}`,
    });
    assert(res11.status === 200 && Array.isArray(res11.body.data) && res11.body.data.length >= 1,
      'Test 11: Admin accesses GET /api/admin/transactions -> 200 OK with transaction history');

    // ------------------------------------------------------------------------
    // TEST 12: Non-admin cannot view transactions
    // ------------------------------------------------------------------------
    const res12 = await makeRequest(server, '/api/admin/transactions', 'GET', null, {
      Authorization: `Bearer ${tokenVendor}`,
    });
    assert(res12.status === 403,
      'Test 12: Vendor blocked from admin transactions endpoint -> 403 Forbidden');

    // ------------------------------------------------------------------------
    // TEST 13: customer.subscription.deleted downgrades vendor to Free
    // ------------------------------------------------------------------------
    const subDeletedEvent = {
      id: `evt_del_${Date.now()}`,
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: testSubId,
          object: 'subscription',
        },
      },
    };

    const subDeletedPayload = JSON.stringify(subDeletedEvent);
    const subDeletedSig = testStripe.webhooks.generateTestHeaderString({
      payload: subDeletedPayload,
      secret: TEST_WEBHOOK_SECRET,
    });

    const res13 = await makeRequest(
      server,
      '/api/stripe/webhook',
      'POST',
      subDeletedPayload,
      {
        'stripe-signature': subDeletedSig,
        'Content-Type': 'application/json',
      }
    );

    assert(res13.status === 200, 'Test 13: Webhook processes customer.subscription.deleted -> 200 OK');

    const downgradedVendor = await users.findOne({ id: vendorId });
    assert(
      downgradedVendor && downgradedVendor.subscriptionPlan === 'free' && downgradedVendor.subscriptionExpiresAt === null,
      'Test 14: Vendor downgraded to Free plan in database upon subscription cancellation'
    );

  } finally {
    // Cleanup test transactions
    await transactions.deleteMany({ vendorId });
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
