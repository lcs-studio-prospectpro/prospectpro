// Plan ladder, modeled on the standard per-seat + feature-gated SaaS pattern used by
// GoHighLevel (Starter/Unlimited/Agency Pro), Close, and Apollo: cheapest tier caps seats
// and locks integrations; higher tiers raise caps and unlock the full toolset.
//
// Product lines:
//  - Cloud dashboard (intro / smallbiz / pro / enterprise / enterprise_key) — multi-user, web-based.
//  - Desktop App (desktop_basic / desktop_plus / desktop_pro) — per-user downloadable license.
//  - Mobile App (mobile_basic / mobile_plus / mobile_pro) — per-user license, field-rep focused.
//  - Enterprise tiers are sales-assisted (no self-serve Stripe Checkout) and priced per seat
//    with volume discounts; Enterprise Key additionally issues redeemable registration keys
//    so the org's own admin can self-provision new logins without individual invites.
const PLANS = {
  // ───────────────────────── CLOUD (multi-user web dashboard) ─────────────────────────
  intro: {
    key: 'intro',
    label: 'Intro',
    price: 19,
    priceId: process.env.STRIPE_PRICE_INTRO,
    seats: 1,
    territories: 1,
    crmSync: false,
    productLine: 'cloud',
    tagline: 'Solo reps getting started with a defined territory.',
    features: [
      '1 user seat',
      '1 active territory / vertical',
      'Search, confirm & call workflow',
      'Call logging & follow-ups',
      'CSV import/export',
    ],
    territoryAddOn: { price: 8, maxAddOns: 4 }, // +$8/mo per extra territory, up to 4 extra
  },
  smallbiz: {
    key: 'smallbiz',
    label: 'Small Business',
    price: 79,
    priceId: process.env.STRIPE_PRICE_SMALLBIZ,
    seats: 10,
    territories: 5,
    crmSync: true,
    productLine: 'cloud',
    tagline: 'Small teams with VAs running multiple territories.',
    features: [
      'Up to 10 user seats',
      'Up to 5 active territories / verticals',
      'VA Task Queue & Leaderboard',
      'Everything in Intro',
      'Bi-directional CRM sync (GoHighLevel, HubSpot, Pipedrive)',
    ],
    territoryAddOn: { price: 6, maxAddOns: 10 }, // +$6/mo per extra territory, up to 10 extra
  },
  pro: {
    key: 'pro',
    label: 'Professional',
    price: 199,
    priceId: process.env.STRIPE_PRICE_PRO,
    seats: 25, // capped (was unlimited) so Enterprise has room to sit above it
    territories: null, // unlimited
    crmSync: true,
    productLine: 'cloud',
    tagline: 'Growing sales orgs running multi-region deployments.',
    features: [
      'Up to 25 user seats',
      'Unlimited territories / verticals',
      'Bi-directional CRM sync, all supported providers',
      'Priority support',
      'Early access to new CRM integrations',
    ],
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    price: 99, // per seat / month, volume-quoted — see pricePerSeat below
    pricePerSeat: 99,
    minSeats: 30,
    maxSeats: 50,
    priceId: null, // sales-assisted, no self-serve Stripe price
    salesAssisted: true,
    seats: 50,
    territories: null,
    crmSync: true,
    productLine: 'cloud',
    tagline: 'Organizations with 30–50 users needing admin controls and dedicated support.',
    features: [
      '30–50 user seats (~$99/seat/mo, volume-quoted)',
      'Unlimited territories / verticals',
      'Admin console with team-wide reporting',
      'SSO-ready (SAML/Google Workspace)',
      'Bi-directional CRM sync, all supported providers',
      'Dedicated onboarding + priority SLA support',
    ],
  },
  enterprise_key: {
    key: 'enterprise_key',
    label: 'Enterprise Key',
    price: 79, // per seat / month, volume-quoted
    pricePerSeat: 79,
    minSeats: 50,
    maxSeats: 100,
    priceId: null,
    salesAssisted: true,
    seats: 100,
    territories: null,
    crmSync: true,
    productLine: 'cloud',
    usesRegistrationKeys: true,
    tagline: 'Organizations with 50–100 users — self-provision seats with registration keys.',
    features: [
      '50–100 user seats (~$79/seat/mo, volume-quoted)',
      'Everything in Enterprise',
      'Registration-key seat provisioning — buy a key block, IT distributes keys, staff redeem their own login',
      'Bulk CSV key export & revoke/reissue',
      'Dedicated customer success manager',
    ],
  },

  // ───────────────────────── DESKTOP APP (per-user downloadable license) ─────────────────────────
  desktop_basic: {
    key: 'desktop_basic',
    label: 'Desktop Basic',
    price: 9,
    priceId: process.env.STRIPE_PRICE_DESKTOP_BASIC || process.env.STRIPE_PRICE_DESKTOP,
    seats: 1,
    territories: 1,
    crmSync: false,
    productLine: 'desktop',
    isDesktop: true,
    tagline: 'One rep, one region. Priced to pay for itself before your first close.',
    features: [
      'Windows & Mac desktop app (1 license per download)',
      '1 territory: one saved county, OR one zip + radius (up to 25mi)',
      'Search, confirm & call workflow',
      'Call logging & follow-ups',
      'CSV import/export',
    ],
    territoryAddOn: { price: 5, maxAddOns: 4 }, // +$5/mo per extra territory, up to 4 extra
  },
  desktop_plus: {
    key: 'desktop_plus',
    label: 'Desktop Plus',
    price: 19,
    priceId: process.env.STRIPE_PRICE_DESKTOP_PLUS,
    seats: 1,
    territories: 3,
    crmSync: true,
    productLine: 'desktop',
    isDesktop: true,
    tagline: 'For reps covering multiple regions who need CRM sync.',
    features: [
      'Everything in Desktop Basic',
      'Up to 3 territories (each a county or a zip+radius area)',
      'Route planning with map view',
      'Bi-directional CRM sync (1 provider)',
    ],
    territoryAddOn: { price: 6, maxAddOns: 5 }, // +$6/mo per extra territory, up to 5 extra
  },
  desktop_pro: {
    key: 'desktop_pro',
    label: 'Desktop Pro',
    price: 27,
    priceId: process.env.STRIPE_PRICE_DESKTOP_PRO,
    seats: 1,
    territories: 10,
    crmSync: true,
    productLine: 'desktop',
    isDesktop: true,
    tagline: 'Power users covering a large multi-county patch from the desktop app.',
    features: [
      'Everything in Desktop Plus',
      'Up to 10 territories (counties or zip+radius areas)',
      'Bi-directional CRM sync, all supported providers',
      'Priority support',
    ],
    territoryAddOn: { price: 4, maxAddOns: 10 }, // +$4/mo per extra territory, up to 10 extra
  },

  // ───────────────────────── MOBILE APP (per-user license, field-rep focused) ─────────────────────────
  mobile_basic: {
    key: 'mobile_basic',
    label: 'Mobile Basic',
    price: 12,
    priceId: process.env.STRIPE_PRICE_MOBILE_BASIC,
    seats: 1,
    territories: 1,
    crmSync: false,
    productLine: 'mobile',
    isMobile: true,
    tagline: 'Field reps who need prospecting in their pocket — entry price a solo rep can absorb.',
    features: [
      'Mobile-optimized app (1 license per user)',
      '1 territory: one saved county, OR one zip + radius (up to 25mi)',
      'Offline mode for spotty coverage',
      'Click-to-call & call logging',
    ],
    territoryAddOn: { price: 6, maxAddOns: 4 }, // +$6/mo per extra territory, up to 4 extra
  },
  mobile_plus: {
    key: 'mobile_plus',
    label: 'Mobile Plus',
    price: 25,
    priceId: process.env.STRIPE_PRICE_MOBILE_PLUS,
    seats: 1,
    territories: 3,
    crmSync: true,
    productLine: 'mobile',
    isMobile: true,
    tagline: 'Reps covering multiple territories with live GPS routing.',
    features: [
      'Everything in Mobile Basic',
      'Up to 3 territories (each a county or a zip+radius area)',
      'GPS-based route optimization',
      'Bi-directional CRM sync (1 provider)',
    ],
    territoryAddOn: { price: 7, maxAddOns: 5 }, // +$7/mo per extra territory, up to 5 extra
  },
  mobile_pro: {
    key: 'mobile_pro',
    label: 'Mobile Pro',
    price: 32,
    priceId: process.env.STRIPE_PRICE_MOBILE_PRO,
    seats: 1,
    territories: 10,
    crmSync: true,
    productLine: 'mobile',
    isMobile: true,
    tagline: 'Full-featured mobile access for top-performing field reps covering a large patch.',
    features: [
      'Everything in Mobile Plus',
      'Up to 10 territories (counties or zip+radius areas) — capped, not unlimited, since territory size varies by market',
      'Bi-directional CRM sync, all supported providers',
      'Team location check-ins',
      'Priority support',
    ],
    territoryAddOn: { price: 5, maxAddOns: 10 }, // +$5/mo per extra territory, up to 10 extra
  },
};

// Plans a tenant can self-serve upgrade/downgrade into via Stripe Checkout.
// Enterprise tiers are intentionally excluded — they're sales-assisted (see salesAssisted flag)
// and go through a "Contact Sales" flow instead of instant checkout.
const ORDER = [
  'trial',
  'desktop_basic', 'desktop_plus', 'desktop_pro',
  'mobile_basic', 'mobile_plus', 'mobile_pro',
  'intro', 'smallbiz', 'pro',
  'enterprise', 'enterprise_key',
];

// Tiers shown grouped by product line in the Billing UI.
const PRODUCT_LINES = [
  { key: 'cloud', label: 'Cloud Dashboard', plans: ['intro', 'smallbiz', 'pro', 'enterprise', 'enterprise_key'] },
  { key: 'desktop', label: 'Desktop App', plans: ['desktop_basic', 'desktop_plus', 'desktop_pro'] },
  { key: 'mobile', label: 'Mobile App', plans: ['mobile_basic', 'mobile_plus', 'mobile_pro'] },
];

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

// Enterprise Key is the only tier where seat count isn't fixed by the plan — it's however
// many registration keys the org has purchased (see LicenseKey model). Use this instead of
// seatLimit() wherever a tenant's plan might be enterprise_key (e.g. before inviting a user).
async function effectiveSeatLimit(tenant, prisma) {
  if (tenant.plan === 'enterprise_key') {
    return prisma.licenseKey.count({ where: { tenantId: tenant.id, status: { not: 'revoked' } } });
  }
  return seatLimit(tenant.plan);
}

// À la carte territory add-on — lets a tenant buy extra territory slots within their current
// tier (same features, just more coverage) instead of jumping a whole tier. Deliberately capped
// per plan (maxAddOns) so heavy users still eventually upgrade rather than stacking forever.
// Not offered on unlimited-territory plans (Professional, Enterprise, Enterprise Key) or trial.
function territoryAddOnConfig(planKey) {
  const plan = getPlan(planKey);
  return (plan && plan.territoryAddOn) || null;
}

// A tenant's real territory ceiling = plan base allotment + purchased add-on slots (capped).
function effectiveTerritoryLimit(tenant) {
  const base = territoryLimit(tenant.plan);
  if (base === null) return null; // already unlimited
  const addOnConfig = territoryAddOnConfig(tenant.plan);
  if (!addOnConfig) return base;
  const purchased = Math.min(tenant.extraTerritories || 0, addOnConfig.maxAddOns);
  return base + purchased;
}

function usesRegistrationKeys(planKey) {
  const plan = getPlan(planKey);
  return !!(plan && plan.usesRegistrationKeys);
}

function isSalesAssisted(planKey) {
  const plan = getPlan(planKey);
  return !!(plan && plan.salesAssisted);
}

module.exports = {
  PLANS,
  ORDER,
  PRODUCT_LINES,
  getPlan,
  seatLimit,
  effectiveSeatLimit,
  territoryLimit,
  territoryAddOnConfig,
  effectiveTerritoryLimit,
  crmSyncAllowed,
  usesRegistrationKeys,
  isSalesAssisted,
};
