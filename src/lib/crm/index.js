const ghl = require('./ghl');
const hubspot = require('./hubspot');
const pipedrive = require('./pipedrive');

const ADAPTERS = { ghl, hubspot, pipedrive };

// Public metadata for the frontend to render provider cards / connect forms.
const PROVIDERS = Object.values(ADAPTERS).map(({ key, name, fields, helpUrl, signupUrl }) => ({ key, name, fields, helpUrl, signupUrl }));

// Not yet built — need OAuth app registration/review (Zoho, Salesforce) or per-account
// board mapping (Monday) before they can be self-serve. Shown as disabled in the UI.
const COMING_SOON = [
  { key: 'zoho', name: 'Zoho CRM' },
  { key: 'monday', name: 'Monday.com' },
  { key: 'salesforce', name: 'Salesforce' },
];

module.exports = { ADAPTERS, PROVIDERS, COMING_SOON };
