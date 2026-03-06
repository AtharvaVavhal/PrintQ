function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ error: `Forbidden. Required role: ${allowedRoles.join(' or ')}.` });
    }
    next();
  };
}

module.exports = requireRole;