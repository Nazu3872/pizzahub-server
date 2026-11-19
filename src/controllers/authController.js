/**
 * Auth Controller for testing and user context inspection
 */

function getMe(req, res) {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
}

function testVendorOnly(req, res) {
  return res.status(200).json({
    success: true,
    message: `Access granted to vendor area for ${req.user.name} (${req.user.businessName || 'Kitchen'})`,
    user: req.user,
  });
}

function testAdminOnly(req, res) {
  return res.status(200).json({
    success: true,
    message: `Access granted to administrator panel for ${req.user.email}`,
    user: req.user,
  });
}

module.exports = {
  getMe,
  testVendorOnly,
  testAdminOnly,
};
