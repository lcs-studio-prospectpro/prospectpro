const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// PATCH /api/tenant — owner can rename their own company/tenant name
router.patch('/', requireAuth, requireRole('owner'), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  const tenant = await prisma.tenant.update({
    where: { id: req.user.tenantId },
    data: { name: name.trim() },
  });
  res.json({ id: tenant.id, name: tenant.name });
});

module.exports = router;
