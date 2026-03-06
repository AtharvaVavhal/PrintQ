const { verifyAccessToken } = require('../utils/jwt');

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed.' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.admin = { sub: payload.sub, role: payload.role, collegeId: payload.collegeId };
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = requireAuth;