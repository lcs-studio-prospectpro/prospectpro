const express = require('express');
const Stripe = require('stripe');
const prisma = require('../lib/prisma');
const { requireAuth, requireRole } = require('../middleware/auth');
const { PLANS, isSalesAssisted, territoryAddOnConfig, effectiveTerritoryLimit, territoryLimit, radiusLimit } = require('../lib/plans');

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// GET /api/billing/plans — public plan ladder for the pricing/upgrade UI
router.get('/plans', (req, res) => {
  res.json(Object.values(PLANS));
});

// POST /api/billing/checkout — owner starts a Stripe Checkout session to upgrade off the trial
router.post('/checkout', requireAuth, requireRole('owner'), async (req, res) => {
  const { plan } = req.body;
  const planConfig = PLANS[plan];
  if (!planConfig) return res.status(400).json({ error: 'Unknown plan' });
  if (isSalesAssisted(plan)) {
    return res.status(400).json({ error: 'This plan is sales-assisted — use /api/billing/contact-sales instead of instant checkout.' });
  }

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

// Sends the Enterprise lead notification via Resend's HTTP API (https://resend.com) — no SDK
// needed, just a POST with an API key. If RESEND_API_KEY isn't set yet, this silently no-ops
// and the lead is still logged to the console/DB, so nothing breaks before the key is added.
async function sendEnterpriseLeadEmail({ tenant, requestedBy, plan, seatsRequested, notes }) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.SALES_NOTIFY_EMAIL || 'ProspectPro@gmail.com';
  const fromAddress = process.env.SALES_FROM_EMAIL || 'ProspectPro <onboarding@resend.dev>';
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not configured yet' };

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [notifyTo],
        reply_to: requestedBy,
        subject: `Enterprise lead: ${tenant.name} (${plan}, ${seatsRequested || '?'} seats)`,
        html: `
          <p><strong>New Enterprise / Enterprise Key lead from ProspectPro</strong></p>
          <ul>
            <li>Company: ${tenant.name}</li>
            <li>Requested by: ${requestedBy}</li>
            <li>Plan: ${plan}</li>
            <li>Seats requested: ${seatsRequested || 'not specified'}</li>
            <li>Notes: ${notes || '(none)'}</li>
            <li>Submitted: ${new Date().toISOString()}</li>
          </ul>`,
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      console.error('[ENTERPRISE LEAD] Resend send failed', resp.status, detail);
      return { sent: false, reason: `Resend API error ${resp.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error('[ENTERPRISE LEAD] Resend send threw', e.message);
    return { sent: false, reason: e.message };
  }
}

// POST /api/billing/contact-sales — Enterprise / Enterprise Key leads (sales-assisted, no Stripe Checkout)
router.post('/contact-sales', requireAuth, requireRole('owner'), async (req, res) => {
  const { plan, seatsRequested, notes } = req.body;
  const planConfig = PLANS[plan];
  if (!planConfig || !isSalesAssisted(plan)) return res.status(400).json({ error: 'Not a sales-assisted plan' });

  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  // Always log it (cheap, reliable audit trail even if email delivery has a hiccup), then also
  // try to email the sales inbox in real time via Resend.
  console.log('[ENTERPRISE LEAD]', {
    tenantId: tenant.id, tenantName: tenant.name, requestedBy: req.user.email,
    plan, seatsRequested, notes, at: new Date().toISOString(),
  });
  const emailResult = await sendEnterpriseLeadEmail({ tenant, requestedBy: req.user.email, plan, seatsRequested, notes });
  res.json({
    received: true,
    message: 'Thanks — our team will reach out shortly to set up your Enterprise plan.',
    notified: emailResult.sent, // useful for admin/debug views; harmless to ignore in the UI
  });
});

// POST /api/billing/territories/set — buy or remove à la carte extra territory slots on the
// tenant's current plan (same features, just more coverage). No tier change, no Stripe checkout
// yet (mirrors /contact-sales for now — flips the DB count directly; wire to a Stripe metered
// line item once real Price IDs exist). Not available on unlimited-territory plans.
router.post('/territories/set', requireAuth, requireRole('owner'), async (req, res) => {
  const { count } = req.body;
  const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
  const addOnConfig = territoryAddOnConfig(tenant.plan);
  if (!addOnConfig) {
    return res.status(400).json({ error: 'Your current plan does not use territory add-ons (either unlimited territories already, or sales-assisted/trial).' });
  }
  const desired = parseInt(count, 10);
  if (!Number.isFinite(desired) || desired < 0) return res.status(400).json({ error: 'count must be a non-negative number' });
  if (desired > addOnConfig.maxAddOns) {
    return res.status(400).json({ error: `You can add up to ${addOnConfig.maxAddOns} extra territories on this plan. For more, upgrade tiers.` });
  }
  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: { extraTerritories: desired } });
  res.json({
    extraTerritories: updated.extraTerritories,
    baseTerritories: territoryLimit(updated.plan),
    effectiveTerritoryLimit: effectiveTerritoryLimit(updated),
    monthlyAddOnCost: desired * addOnConfig.price,
    pricePerTerritory: addOnConfig.price,
    maxAddOns: addOnConfig.maxAddOns,
  });
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
  const addOnConfig = territoryAddOnConfig(tenant.plan);
  res.json({
    plan: tenant.plan, subscriptionStatus: tenant.subscriptionStatus, trialEndsAt: tenant.trialEndsAt,
    trialDaysLeft: tenant.trialEndsAt ? Math.max(0, Math.ceil((tenant.trialEndsAt - new Date()) / 86400000)) : null,
    baseTerritories: territoryLimit(tenant.plan),
    extraTerritories: tenant.extraTerritories || 0,
    effectiveTerritoryLimit: effectiveTerritoryLimit(tenant),
    territoryAddOn: addOnConfig, // null if this plan doesn't support add-ons (unlimited / sales-assisted / trial)
    maxRadiusMiles: radiusLimit(tenant.plan), // caps zip+radius search; county-based territories are unaffected
  });
});

module.exports = router;
