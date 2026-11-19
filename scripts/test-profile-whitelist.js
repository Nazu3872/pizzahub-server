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
  console.log('       PIZZAHUB STEP 12: PROFILE WHITELIST & STATS      ');
  console.log('========================================================\n');

  await connectDB();
  const db = getDB();
  const users = db.collection('user');

  const testUserId = '6afeba851c4083c4535d4e01';
  await users.updateOne(
    { email: 'profile.test@pizzahub.com' },
    {
      $set: {
        id: testUserId,
        name: 'Initial Name',
        role: 'customer',
        subscriptionPlan: 'free',
        isBlocked: false,
      },
    },
    { upsert: true }
  );

  const token = await createToken(testUserId, 'profile.test@pizzahub.com', 'customer');
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
    // TEST 1: Update name and valid image works
    const res1 = await makeRequest(
      server,
      '/api/users/profile',
      'PATCH',
      { name: 'Updated Full Name', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb' },
      { Authorization: `Bearer ${token}` }
    );
    assert(res1.status === 200 && res1.body.user.name === 'Updated Full Name',
      'Test 1: User updates whitelisted fields (name, image) -> 200 OK');

    // TEST 2: Attempting to escalate role to admin is rejected
    const res2 = await makeRequest(
      server,
      '/api/users/profile',
      'PATCH',
      { role: 'admin' },
      { Authorization: `Bearer ${token}` }
    );
    assert(res2.status === 403,
      'Test 2: Privilege escalation tampering (role: admin) -> 403 Forbidden');

    // TEST 3: Attempting to self-upgrade subscriptionPlan is rejected
    const res3 = await makeRequest(
      server,
      '/api/users/profile',
      'PATCH',
      { subscriptionPlan: 'premium' },
      { Authorization: `Bearer ${token}` }
    );
    assert(res3.status === 403,
      'Test 3: Subscription tampering (subscriptionPlan: premium) -> 403 Forbidden');

    // TEST 4: Attempting to tamper with isBlocked status is rejected
    const res4 = await makeRequest(
      server,
      '/api/users/profile',
      'PATCH',
      { isBlocked: false },
      { Authorization: `Bearer ${token}` }
    );
    assert(res4.status === 403,
      'Test 4: Tampering with isBlocked status -> 403 Forbidden');

    // TEST 5: Verify user in database is still customer and free plan
    const dbUser = await users.findOne({ id: testUserId });
    assert(dbUser.role === 'customer' && dbUser.subscriptionPlan === 'free',
      'Test 5: DB verification proves user role and subscription remain untampered');

    // TEST 6: Customer stats endpoint works
    const res6 = await makeRequest(server, '/api/customer/stats', 'GET', null, {
      Authorization: `Bearer ${token}`,
    });
    assert(res6.status === 200 && Array.isArray(res6.body.data.ordersChart),
      'Test 6: Customer stats returns aggregated order metrics and Recharts dataset');

  } finally {
    server.close();
  }

  console.log(`\nResults: ${passed}/${total} tests passed.\n`);
  if (passed !== total) process.exit(1);
}

runTests().catch(console.error);
