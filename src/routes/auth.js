const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { effectiveSeatLimit } = require('../lib/plans');

const router = express.Router();

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Default starter verticals for a brand-new tenant — fully editable/removable after signup.
const DEFAULT_VERTICALS = [
  { key: 'general', label: 'General Prospects', categoryCode: 'GEN' },
];

// POST /api/auth/signup — creates a brand-new tenant (company) + its first owner user
router.post('/signup', async (req, res) => {
  const { companyName, name, email, password } = req.body;
  if (!companyName || !name || !email || !password) {
    return res.status(400).json({ error: 'companyName, name, email, and password are required' });
  }
  const slugBase = slugify(companyName);
  let slug = slugBase;
  let n = 1;
  while (await prisma.tenant.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${++n}`;
  }

  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14-day trial

  const tenant = await prisma.tenant.create({
    data: {
      name: companyName,
      slug,
      plan: 'trial',
      subscriptionStatus: 'trialing',
      trialEndsAt,
      verticals: { create: DEFAULT_VERTICALS },
    },
  });

  const passwordHash = await bcrypt.hash(password, 10);
  const vaCode = email.split('@')[0].toUpperCase();
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, passwordHash, name, role: 'owner', vaCode },
  });

  const token = signToken(user);
  res.status(201).json({
    token,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan, trialEndsAt },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findFirst({ where: { email }, include: { tenant: true } });
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken(user);
  res.json({
    token,
    tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, plan: user.tenant.plan },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

// POST /api/auth/invite — owner/admin invites a teammate into their tenant
router.post('/invite', async (req, res) => {
  const { tenantId, name, email, password, role } = req.body;
  if (!['admin', 'rep', 'va'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, rep, or va' });
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const limit = await effectiveSeatLimit(tenant, prisma);
  if (limit !== null) {
    const seatCount = await prisma.user.count({ where: { tenantId } });
    if (seatCount >= limit) {
      return res.status(403).json({ error: `Your plan includes ${limit} seat(s). Upgrade to add more team members.` });
    }
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const vaCode = email.split('@')[0].toUpperCase();
  const user = await prisma.user.create({
    data: { tenantId, email, passwordHash, name, role, vaCode },
  });
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

// POST /api/auth/redeem-key — an employee at an Enterprise Key org creates their own login
// by redeeming a registration key their admin distributed, instead of waiting for an invite.
router.post('/redeem-key', async (req, res) => {
  const { code, name, email, password } = req.body;
  if (!code || !name || !email || !password) {
    return res.status(400).json({ error: 'code, name, email, and password are required' });
  }
  const key = await prisma.licenseKey.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!key) return res.status(404).json({ error: 'Registration key not found' });
  if (key.status !== 'unassigned') return res.status(400).json({ error: `This key is already ${key.status}` });
  if (key.assignedEmail && key.assignedEmail.toLowerCase() !== email.toLowerCase()) {
    return res.status(400).json({ error: 'This key is reserved for a different email address' });
  }

  const existing = await prisma.user.findFirst({ where: { tenantId: key.tenantId, email } });
  if (existing) return res.status(409).json({ error: 'A user with this email already exists on this team' });

  const passwordHash = await bcrypt.hash(password, 10);
  const vaCode = email.split('@')[0].toUpperCase();
  const user = await prisma.user.create({
    data: { tenantId: key.tenantId, email, passwordHash, name, role: 'rep', vaCode },
  });
  await prisma.licenseKey.update({
    where: { id: key.id },
    data: { status: 'redeemed', redeemedByUserId: user.id, redeemedAt: new Date() },
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: key.tenantId } });
  const token = signToken(user);
  res.status(201).json({
    token,
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: tenant.plan },
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

module.exports = router;
