const { createRemoteJWKSet, jwtVerify } = require('jose');
const { ObjectId } = require('mongodb');
const config = require('../config/env');
const { getDB } = require('../db/connection');

let remoteJWKS = null;

function getJWKS() {
  if (!remoteJWKS) {
    const jwksUrl =
      config.betterAuthJwksUrl ||
      `${(config.clientUrl || 'https://pizzahub-client-nazu2.vercel.app').replace(/\/$/, '')}/api/auth/jwks`;
    try {
      remoteJWKS = createRemoteJWKSet(new URL(jwksUrl));
    } catch (e) {
      console.warn('Could not initialize remote JWKS:', e.message);
    }
  }
  return remoteJWKS;
}

/**
 * Verify JWT signature against Better Auth JWKS or secret fallback.
 * Strictly loads the user from the MongoDB database to enforce real DB role and isBlocked status.
 */
async function verifyJWT(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Missing or malformed Bearer token',
    });
  }

  const token = authHeader.split(' ')[1]?.trim();
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Empty token provided',
    });
  }

  let payload = null;

  try {
    const jwks = getJWKS();
    if (jwks) {
      try {
        const { payload: verifiedPayload } = await jwtVerify(token, jwks);
        payload = verifiedPayload;
      } catch (jwksErr) {
        // Fallback to symmetric secret if available
        if (process.env.BETTER_AUTH_SECRET) {
          const secret = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);
          const { payload: verifiedPayload } = await jwtVerify(token, secret);
          payload = verifiedPayload;
        } else {
          throw jwksErr;
        }
      }
    } else if (process.env.BETTER_AUTH_SECRET) {
      const secret = new TextEncoder().encode(process.env.BETTER_AUTH_SECRET);
      const { payload: verifiedPayload } = await jwtVerify(token, secret);
      payload = verifiedPayload;
    } else {
      return res.status(500).json({
        success: false,
        message: 'JWT verification key/JWKS endpoint is not configured on server',
      });
    }
  } catch (jwtErr) {
    return res.status(401).json({
      success: false,
      message: `Unauthorized: ${jwtErr.message || 'Invalid or expired JWT token'}`,
    });
  }

  // Extract user identifier from token
  const userId = payload.sub || payload.id || payload.userId;
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid token claims (missing user id)',
    });
  }

  // Load real user directly from database (Never trust token claims alone)
  try {
    const db = getDB();
    const usersCollection = db.collection('user');
    
    // Find by string ID, ObjectId, or email
    const query = [{ id: userId }];
    if (ObjectId.isValid(userId)) {
      query.push({ _id: new ObjectId(userId) });
    }
    if (payload.email) {
      query.push({ email: payload.email });
    }

    const user = await usersCollection.findOne({ $or: query });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User account not found in database',
      });
    }

    // Check if account has been blocked/suspended
    if (user.isBlocked === true) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Account has been suspended by administrator',
      });
    }

    // Enforce subscription expiry: a Premium plan past its expiry date is free
    let effectivePlan = user.subscriptionPlan || 'free';
    if (
      effectivePlan === 'premium' &&
      user.subscriptionExpiresAt &&
      new Date(user.subscriptionExpiresAt).getTime() <= Date.now()
    ) {
      effectivePlan = 'free';
      // Persist the downgrade so all future reads are consistent
      try {
        await usersCollection.updateOne(
          { $or: query },
          { $set: { subscriptionPlan: 'free' } }
        );
      } catch (downgradeErr) {
        console.error('Failed to persist expired subscription downgrade:', downgradeErr.message);
      }
    }

    // Attach verified user with DATABASE role
    req.user = {
      id: user.id || user._id?.toString(),
      email: user.email,
      name: user.name,
      role: user.role || 'customer',
      isBlocked: Boolean(user.isBlocked),
      businessName: user.businessName,
      subscriptionPlan: effectivePlan,
      subscriptionExpiresAt: user.subscriptionExpiresAt,
    };

    next();
  } catch (dbErr) {
    return res.status(500).json({
      success: false,
      message: `Database error during user verification: ${dbErr.message}`,
    });
  }
}

/**
 * Middleware: require specific role(s) -> 403 if forbidden
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Authentication required',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Requires role in [${allowedRoles.join(', ')}]`,
      });
    }

    next();
  };
}

/**
 * Middleware: explicitly block suspended users
 */
function blockIfBlocked(req, res, next) {
  if (req.user && req.user.isBlocked) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Account has been suspended by administrator',
    });
  }
  next();
}

/**
 * Ownership helper: verifies if current user owns the resource or is an admin
 */
function checkOwnership(resourceOwnerId, reqUser) {
  if (!reqUser) return false;
  if (reqUser.role === 'admin') return true;
  return resourceOwnerId?.toString() === reqUser.id?.toString();
}

module.exports = {
  verifyJWT,
  requireRole,
  blockIfBlocked,
  checkOwnership,
};
