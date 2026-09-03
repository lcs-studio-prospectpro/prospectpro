// Plan ladder, modeled on the standard per-seat + feature-gated SaaS pattern used by
// GoHighLevel (Starter/Unlimited/Agency Pro), Close, and Apollo: cheapest tier caps seats
// and locks integrations; the top tier removes caps and unlocks the full toolset.
const PLANS = {
  desktop: {
    key: 'desktop',
    label: 'Desktop',
    price: 12,
    priceId: process.env.STRIPE_PRICE_DESKTOP,
    seats: 1,
    territories: 1,
    crmSync: false,
    isDesktop: true, // downloadable single-license desktop app, not the multi-user cloud dashboard
    tagline: 'One rep, one region. Download the desktop app and go — no team setup required.',
    features: [
      'Windows & Mac desktop app (1 license per download)',
      'Set your region once by county or zip code',
      'Search, confirm & call workflow',
      'Call logging & follow-ups',
      'CSV import/export',
    ],
  },
  intro: {
    key: 'intro',
    label: 'Intro',
    price: 19,
    priceId: process.env.STRIPE_PRICE_INTRO,
    seats: 1,
    territories: 1,
    crmSync: false,
    tagline: 'Solo reps getting started with a defined territory.',
    features: [
      '1 user seat',
      '1 active territory / vertical',
      'Search, confirm & call workflow',
      'Call logging & follow-ups',
      'CSV import/export',
    ],
  },
  smallbiz: {
    key: 'smallbiz',
    label: 'Small Business',
    price: 79,
    priceId: process.env.STRIPE_PRICE_SMALLBIZ,
    seats: 10,
    territories: 5,
    crmSync: true,
    tagline: 'Small teams with VAs running multiple territories.',
    features: [
      'Up to 10 user seats',
      'Up to 5 active territories / verticals',
      'VA Task Queue & Leaderboard',
      'Everything in Intro',
      'Bi-directional CRM sync (GoHighLevel, HubSpot, Pipedrive)',
    ],
  },
  pro: {
    key: 'pro',
    label: 'Professional',
    price: 199,
    priceId: process.env.STRIPE_PRICE_PRO,
    seats: null, // unlimited
    territories: null, // unlimited
    crmSync: true,
    tagline: 'Growing sales orgs and multi-region deployments.',
    features: [
      'Unlimited user seats',
      'Unlimited territories / verticals',
      'Bi-directional CRM sync, all supported providers',
      'Priority support',
      'Early access to new CRM integrations',
    ],
  },
};

// Plans a tenant can self-serve upgrade/downgrade into via Stripe Checkout.
const ORDER = ['trial', 'desktop', 'intro', 'smallbiz', 'pro'];

function getPlan(planKey) {
  return PLANS[planKey] || null;
}

function seatLimit(planKey) {
  if (planKey === 'trial') return 3; // trial mirrors Intro-ish limits so teams can test seats
  const plan = getPlan(planKey);
  return plan ? plan.seats : 1;
}

function territoryLimit(planKey) {
  if (planKey === 'trial') return 1;
  const plan = getPlan(planKey);
  return plan ? plan.territories : 1;
}

function crmSyncAllowed(planKey) {
  if (planKey === 'trial') return true; // let trials test the feature before buying
  const plan = getPlan(planKey);
  return plan ? plan.crmSync : false;
}

module.exports = { PLANS, ORDER, getPlan, seatLimit, territoryLimit, crmSyncAllowed };
