const express = require('express');
const Stripe = require('stripe');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { PLANS } = require('../lib/plans');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /api/billing/plans — public plan ladder for the pricing/upgrade UI
router.get('/plans', (req, res) => {
  res.json(Object.values(PLANS));
});

// POST /api/billing/checkout — owner starts a Stripe Checkout session to upgrade off the trial
router.post('/checkout', requireAuth, requireRole('owner'), async (req, res) => {
  const { plan } = req.body; // 'intro' | 'smallbiz' | 'pro'
  const planConfig = PLANS[plan];
  if (!planConfig) return res.status(400).json({ error: 'Unknown plan' });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });

  try {
    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
      });
      customerId = customer.id;
      await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL || 'http://localhost:4000'}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL || 'http://localhost:4000'}/billing/cancel`,
      metadata: { tenantId: tenant.id, plan },
    });
    res.json({ checkoutUrl: session.url });
  } catch (e) {
    // Expected in dev without real Stripe keys — this is a structurally-complete integration,
    // just needs a live secret key + real Price IDs from the Stripe dashboard to go live.
    res.status(500).json({ error: 'Stripe not configured yet (placeholder keys in .env)', detail: e.message });
  }
});

// POST /api/billing/webhook — Stripe calls this on subscription events (must use raw body — see server.js)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      await prisma.tenant.update({
        where: { id: session.metadata.tenantId },
        data: { plan: session.metadata.plan, subscriptionStatus: 'active', stripeSubId: session.subscription },
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenant = await prisma.tenant.findFirst({ where: { stripeSubId: sub.id } });
      if (tenant) await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: 'canceled', plan: 'trial' } });
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const tenant = await prisma.tenant.findFirst({ where: { stripeCustomerId: invoice.customer } });
      if (tenant) await prisma.tenant.update({ where: { id: tenant.id }, data: { subscriptionStatus: 'past_due' } });
      break;
    }
  }
  res.json({ received: true });
});

// GET /api/billing/status
router.get('/status', requireAuth, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  res.json({
    plan: tenant.plan, subscriptionStatus: tenant.subscriptionStatus, trialEndsAt: tenant.trialEndsAt,
    trialDaysLeft: tenant.trialEndsAt ? Math.max(0, Math.ceil((tenant.trialEndsAt - new Date()) / 86400000)) : null,
  });
});

module.exports = router;
