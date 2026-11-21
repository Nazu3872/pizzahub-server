# PizzaHub — Pizza Ordering & Delivery Platform (Backend Server)

This is the robust Express.js REST API powering the **PizzaHub** ordering and delivery platform. It features asymmetric JWT authentication via Better Auth JWKS, role-based access control (RBAC), multi-vendor menu management, customer ordering lifecycles, administrative moderation, and Stripe Checkout subscription webhooks.

- **Live API Endpoint**: [https://pizzahub-server-nazu2.vercel.app](https://pizzahub-server-nazu2.vercel.app)
- **Live Client Web App**: [https://pizzahub-client-nazu2.vercel.app](https://pizzahub-client-nazu2.vercel.app)
- **Server Repository**: [https://github.com/Nazu3872/pizzahub-server](https://github.com/Nazu3872/pizzahub-server)
- **Client Repository**: [https://github.com/Nazu3872/pizzahub-client](https://github.com/Nazu3872/pizzahub-client)

---

## 🌟 Architecture & Core Features

### 1. Robust Security & JWT Middleware Pipeline
- **Zero-Trust Asymmetric Authentication**: Token signatures are verified against the client's JWKS endpoint (`/api/auth/jwks`) with cryptographic EdDSA algorithms using the `jose` library.
- **Database Role Enforcement**: User roles (`admin`, `vendor`, `customer`) and account suspension states (`isBlocked`) are fetched directly from MongoDB on every request, completely ignoring client-tampered claims.
- **Granular RBAC**: Dedicated middleware functions (`requireRole('admin')`, `requireRole('vendor')`, `requireRole('customer')`, `blockIfBlocked`) protect private endpoints with strict `401 Unauthorized` and `403 Forbidden` status codes.
- **Resource Ownership Verification**: Vendors can only modify or delete their own menu items and update orders placed for their pizzeria.

### 2. Business Domains & Collections
- **`menuItems`**: Public approved listings and vendor private catalog. Includes category constraints, price, description, images, location, and approval status (`pending`, `approved`, `rejected`, `inactive`).
- **`orders`**: Customer pizza orders with selected item, vendor association, customer ID, delivery date, delivery address, custom message, and order status (`pending`, `accepted`, `rejected`, `cancelled`).
- **`transactions`**: Immutable ledger recording Stripe subscription payments (`vendorId`, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt`). Admins have read-only access (no PUT/PATCH/DELETE allowed).
- **`user`**: User accounts managed by Better Auth with custom schema extensions (`role`, `isBlocked`, `businessName`, `subscriptionPlan`, `subscriptionExpiresAt`).

### 3. Stripe Subscription & Webhook Processing
- **Serverless Webhook Handler**: Uses `express.raw({ type: 'application/json' })` mounted before `express.json()` to verify raw payload signatures with `STRIPE_WEBHOOK_SECRET`.
- **Supported Events**:
  - `checkout.session.completed`: Sets `subscriptionPlan = "premium"` and computes `subscriptionExpiresAt`.
  - `invoice.paid`: Renews subscription period.
  - `invoice.payment_failed` & `customer.subscription.deleted`: Gracefully downgrades vendor to Free tier.
- **Idempotency**: Prevents duplicate transaction records by indexing and verifying unique `stripeSessionId`.

---

## 🛠️ Technology Stack & Dependencies

- **Runtime**: Node.js
- **Web Framework**: Express.js (`express`)
- **Database**: MongoDB Native Node.js Driver (`mongodb`)
- **Security & Cryptography**: Jose (`jose` for EdDSA JWKS & JWT verification), Helmet (`helmet`), CORS (`cors`)
- **Payment Processing**: Stripe Node SDK (`stripe`)
- **Configuration**: Dotenv (`dotenv`)

---

## 🚀 Local Development Setup

### Prerequisites
- Node.js (v18 or higher)
- npm
- Running MongoDB Atlas cluster or local MongoDB instance

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Nazu3872/pizzahub-server.git
   cd pizzahub-server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   NODE_ENV=development
   MONGODB_URI=your_mongodb_connection_string
   DB_NAME=pizzahub
   CLIENT_URL=http://localhost:3000
   BETTER_AUTH_URL=http://localhost:3000
   BETTER_AUTH_SECRET=your_better_auth_secret
   BETTER_AUTH_JWKS_URL=http://localhost:3000/api/auth/jwks
   STRIPE_SECRET_KEY=your_stripe_secret_key
   STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
   STRIPE_PREMIUM_PRICE_ID=your_stripe_premium_price_id
   ```

4. **Start the API Server:**
   ```bash
   npm start
   ```
   Server will start on `http://localhost:5000`.

---

## 🔑 Environment Variables Reference

| Variable Name | Description |
|---|---|
| `PORT` | Local server port (Default: `5000`) |
| `NODE_ENV` | Environment mode (`development` or `production`) |
| `MONGODB_URI` | MongoDB Atlas cluster connection URI |
| `DB_NAME` | Target database name (`pizzahub`) |
| `CLIENT_URL` | Allowed client URL for CORS (e.g. `https://pizzahub-client-nazu2.vercel.app`) |
| `BETTER_AUTH_URL` | Client Better Auth URL |
| `BETTER_AUTH_SECRET` | Secret key matching client Better Auth secret |
| `BETTER_AUTH_JWKS_URL` | Public JWKS endpoint (`https://pizzahub-client-nazu2.vercel.app/api/auth/jwks`) |
| `STRIPE_SECRET_KEY` | Stripe secret API key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PREMIUM_PRICE_ID` | Stripe Price ID for vendor Premium recurring plan |

---

## 🏆 Challenge Requirements Implementation Notes

### 1. Advanced Search & Sorting Implementation
- **Query Parameter Specification**:
  - `GET /api/menu-items?search=margherita&category=Classic%20Pizzas&location=Downtown&sort=price_asc&page=1&limit=12`
  - Handled by `getPublicMenuItems` controller in `src/controllers/menuController.js`:
    ```javascript
    const query = { status: 'approved' };
    if (search) query.itemName = { $regex: search.trim(), $options: 'i' };
    if (category) query.category = category.trim();
    if (location) query.location = { $regex: location.trim(), $options: 'i' };

    const sortOptions = {};
    if (sort === 'price_asc') sortOptions.price = 1;
    else if (sort === 'price_desc') sortOptions.price = -1;
    else sortOptions.createdAt = -1;
    ```
  - Returns paginated documents, total count, current page, and total pages.

### 2. JWT Verification Middleware Pipeline
- Implemented in `src/middleware/auth.js`:
  1. **Token Extraction**: Extracts the bearer token from `req.headers.authorization`. If missing, returns `401 Unauthorized: Missing or malformed Bearer token`.
  2. **Asymmetric Cryptographic Verification**: Calls `getJWKS()` to obtain the client's public keys via `createRemoteJWKSet(BETTER_AUTH_JWKS_URL)`. Executes `jwtVerify(token, jwks)` to validate the EdDSA signature and token expiration.
  3. **Database Look-up**: Resolves `userId = payload.sub || payload.id`. Queries the authoritative `user` collection in MongoDB.
  4. **Suspension Check**: If `user.isBlocked === true`, terminates with `403 Forbidden: Account has been suspended`.
  5. **Context Binding**: Attaches verified user context to `req.user` (`id`, `email`, `role`, `businessName`, `subscriptionPlan`).
  6. **RBAC Guard**: Subsequent routes guarded by `requireRole('vendor')` or `requireRole('admin')` inspect `req.user.role` and reject unauthorized actors with `403 Forbidden`.

---

## 🧪 Admin & Test Instructions

### Platform Administrator Credentials
- **Admin Email**: `nazmunnahar.codeware@gmail.com`
- **Admin Password**: `PizzaAdmin2026!`

### Stripe Test Card for Subscription Flow
- **Card Number**: `4242 4242 4242 4242`
- **Expiry**: Any future date (e.g. `12/28`)
- **CVC**: `123`
