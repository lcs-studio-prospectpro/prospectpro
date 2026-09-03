const API = '/api';
let state = {
  token: localStorage.getItem('pp_token') || null,
  user: JSON.parse(localStorage.getItem('pp_user') || 'null'),
  tenant: JSON.parse(localStorage.getItem('pp_tenant') || 'null'),
  verticals: [],
  selectedVerticalId: null,
  contacts: [],
  tasks: [],
  currentView: 'contacts',
};

// ── API helper ──
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ──
function showSignup() { document.getElementById('loginForm').classList.add('hidden'); document.getElementById('signupForm').classList.remove('hidden'); clearAuthError(); }
function showLogin() { document.getElementById('signupForm').classList.add('hidden'); document.getElementById('loginForm').classList.remove('hidden'); clearAuthError(); }
function clearAuthError() { document.getElementById('authError').classList.add('hidden'); }
function authError(msg) { const el = document.getElementById('authError'); el.textContent = msg; el.classList.remove('hidden'); }

async function signup() {
  clearAuthError();
  const companyName = document.getElementById('su_company').value.trim();
  const name = document.getElementById('su_name').value.trim();
  const email = document.getElementById('su_email').value.trim();
  const password = document.getElementById('su_password').value;
  if (!companyName || !name || !email || !password) return authError('All fields are required.');
  try {
    const data = await api('/auth/signup', { method: 'POST', body: { companyName, name, email, password } });
    onAuthed(data);
  } catch (e) { authError(e.message); }
}

async function login() {
  clearAuthError();
  const email = document.getElementById('li_email').value.trim();
  const password = document.getElementById('li_password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: { email, password } });
    onAuthed(data);
  } catch (e) { authError(e.message); }
}

function onAuthed(data) {
  state.token = data.token; state.user = data.user; state.tenant = data.tenant;
  localStorage.setItem('pp_token', data.token);
  localStorage.setItem('pp_user', JSON.stringify(data.user));
  localStorage.setItem('pp_tenant', JSON.stringify(data.tenant));
  boot();
}

function logout() {
  localStorage.removeItem('pp_token'); localStorage.removeItem('pp_user'); localStorage.removeItem('pp_tenant');
  location.reload();
}

// ── Boot ──
async function boot() {
  if (!state.token) return;
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('tenantName').textContent = state.tenant.name;
  document.getElementById('userName').textContent = state.user.name;
  document.getElementById('userRole').textContent = state.user.role;

  await loadVerticals();
  await loadBillingStatus();
  switchView('contacts');
}

async function loadBillingStatus() {
  try {
    const status = await api('/billing/status');
    if (status.subscriptionStatus === 'trialing') {
      const pill = document.getElementById('trialPill');
      pill.textContent = `Trial · ${status.trialDaysLeft}d left`;
      pill.classList.remove('hidden');
    }
  } catch (e) {}
}

async function loadVerticals() {
  state.verticals = await api('/verticals');
  if (!state.selectedVerticalId && state.verticals.length) state.selectedVerticalId = state.verticals[0].id;
}

// ── Navigation ──
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.getElementById('addContactBtn').classList.toggle('hidden', view !== 'contacts');
  document.getElementById('importContactsBtn').classList.toggle('hidden', view !== 'contacts');
  const titles = { contacts: 'Contacts', tasks: 'VA Task Queue', leaderboard: 'Team Leaderboard', verticals: 'Verticals & Categories', billing: 'Billing & Plan' };
  document.getElementById('viewTitle').textContent = titles[view];
  if (view === 'contacts') renderContactsView();
  if (view === 'tasks') renderTasksView();
  if (view === 'leaderboard') renderLeaderboardView();
  if (view === 'verticals') renderVerticalsView();
  if (view === 'billing') renderBillingView();
}

// ── CONTACTS VIEW ──
async function renderContactsView() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="toolbar" id="verticalChips"></div>
    <div class="grid" id="contactsGrid"><div class="empty">Loading…</div></div>
  `;
  renderVerticalChips();
  await loadContactsForSelectedVertical();
}

function renderVerticalChips() {
  const wrap = document.getElementById('verticalChips');
  if (!wrap) return;
  wrap.innerHTML = state.verticals.map(v => `
    <span class="vertical-chip ${v.id === state.selectedVerticalId ? 'active' : ''}" onclick="selectVertical('${v.id}')">
      ${v.label} <span class="vertical-count">${v._count?.contacts ?? ''}</span>
    </span>
  `).join('') || '<span style="font-size:12px;color:var(--mute)">No verticals yet — add one in the Verticals tab.</span>';
}

async function selectVertical(id) {
  state.selectedVerticalId = id;
  renderVerticalChips();
  await loadContactsForSelectedVertical();
}

async function loadContactsForSelectedVertical() {
  const grid = document.getElementById('contactsGrid');
  if (!state.selectedVerticalId) { grid.innerHTML = '<div class="empty">Create a vertical first.</div>'; return; }
  state.contacts = await api('/contacts?verticalId=' + state.selectedVerticalId);
  if (!state.contacts.length) { grid.innerHTML = '<div class="empty">No contacts yet in this vertical. Click "+ Add Contact" to start.</div>'; return; }
  grid.innerHTML = state.contacts.map(contactCardHTML).join('');
}

function contactCardHTML(c) {
  const phoneOk = !!c.phone, emailOk = !!c.email, addrOk = !!c.address;
  return `
  <div class="card contact-card tier-${c.tier}">
    <div class="dot-row">
      <span class="dot ${phoneOk ? 'ok' : 'bad'}" title="Phone"></span>
      <span class="dot ${emailOk ? 'ok' : 'bad'}" title="Email"></span>
      <span class="dot ${addrOk ? 'ok' : 'bad'}" title="Address"></span>
    </div>
    <div class="contact-name">${c.name}</div>
    <div class="contact-meta">${c.contactName || 'No contact name'} ${c.contactTitle ? '· ' + c.contactTitle : ''}</div>
    <div class="contact-meta">${c.address || 'No address on file'}</div>
    <div class="contact-meta">${c.phone || '—'} · ${c.email || '—'}</div>
    <div class="tag">${c.categoryId || 'uncategorized'}</div>
    ${c.dataConfirmed
      ? `<div class="badge-confirmed">✓ Confirmed</div><button class="btn" style="margin-top:8px;font-size:11px" onclick="openCallLogModal('${c.id}')">📞 Log Call</button>`
      : `<div class="confirm-row"><button class="btn" style="font-size:11px" onclick="confirmContact('${c.id}')">✓ Confirm data</button></div>`
    }
  </div>`;
}

async function confirmContact(id) {
  await api('/contacts/' + id, { method: 'PATCH', body: { confirm: true } });
  await loadVerticals(); // refresh counts
  await loadContactsForSelectedVertical();
}

function openAddContactModal() {
  if (!state.selectedVerticalId) return alert('Create a vertical first (Verticals tab).');
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Add Contact</h3>
        <div class="field"><label>Company name</label><input id="nc_name" placeholder="Acme Architecture"></div>
        <div class="field"><label>Contact name</label><input id="nc_contact_name" placeholder="Jane Smith"></div>
        <div class="field"><label>Title</label><input id="nc_contact_title" placeholder="Principal"></div>
        <div class="field"><label>Address</label><input id="nc_address" placeholder="123 Main St, City, ST"></div>
        <div class="field"><label>Phone</label><input id="nc_phone" placeholder="(555) 555-5555"></div>
        <div class="field"><label>Email</label><input id="nc_email" placeholder="jane@acme.com"></div>
        <div class="field"><label>Tier</label>
          <select id="nc_tier" class="select" style="width:100%">
            <option value="A">Tier A</option><option value="B" selected>Tier B</option><option value="C">Tier C</option>
          </select>
        </div>
        <div id="addContactError" class="auth-error hidden"></div>
        <button class="btn primary" onclick="saveNewContact()">Save Contact</button>
      </div>
    </div>`;
}

async function saveNewContact() {
  const body = {
    verticalId: state.selectedVerticalId,
    name: document.getElementById('nc_name').value.trim(),
    contactName: document.getElementById('nc_contact_name').value.trim(),
    contactTitle: document.getElementById('nc_contact_title').value.trim(),
    address: document.getElementById('nc_address').value.trim(),
    phone: document.getElementById('nc_phone').value.trim(),
    email: document.getElementById('nc_email').value.trim(),
    tier: document.getElementById('nc_tier').value,
  };
  if (!body.name) return;
  try {
    await api('/contacts', { method: 'POST', body });
    closeModal();
    await loadVerticals();
    await loadContactsForSelectedVertical();
  } catch (e) {
    const el = document.getElementById('addContactError');
    el.textContent = e.message; el.classList.remove('hidden');
  }
}

function openCallLogModal(contactId) {
  const contact = state.contacts.find(c => c.id === contactId);
  const vertical = state.verticals.find(v => v.id === (contact?.verticalId || state.selectedVerticalId));
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Log Call</h3>
        ${vertical?.callScript ? `<div class="banner">📋 Suggested opener for ${vertical.label}: "${vertical.callScript}"</div>` : ''}
        <div class="field"><label>Outcome</label>
          <select id="cl_outcome" class="select" style="width:100%">
            <option value="positive">Positive</option><option value="hesitant">Hesitant</option>
            <option value="low">Low interest</option><option value="ready">Ready to buy</option>
          </select>
        </div>
        <div class="field"><label>Notes</label><input id="cl_notes" placeholder="What happened on the call?"></div>
        <div class="field"><label>Next action</label><input id="cl_next" placeholder="e.g. Send spec sheet"></div>
        <button class="btn primary" onclick="saveCallLog('${contactId}')">Save Call Log</button>
      </div>
    </div>`;
}

async function saveCallLog(contactId) {
  const body = {
    contactId,
    outcome: document.getElementById('cl_outcome').value,
    notes: document.getElementById('cl_notes').value.trim(),
    nextAction: document.getElementById('cl_next').value.trim(),
  };
  await api('/call-logs', { method: 'POST', body });
  closeModal();
  alert('✓ Call logged — visible to your whole team.');
}

function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

// ── CSV IMPORT ──
function openImportModal() {
  if (!state.selectedVerticalId) return alert('Select a vertical first.');
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this) closeModal()">
      <div class="modal">
        <h3>Import Contacts from CSV</h3>
        <div class="banner">First row must be a header with any of: name, contactName, contactTitle, address, phone, email, website, tier. Only "name" is required. Import still respects your batch/confirm-rate rule — rows past a locked batch will be skipped and listed.</div>
        <div class="field"><label>Paste CSV</label>
          <textarea id="csv_text" rows="8" style="width:100%;font-family:monospace;font-size:12px;padding:8px;border:1px solid var(--border);border-radius:8px" placeholder="name,phone,email,address&#10;Acme Architecture,555-1234,info@acme.com,123 Main St"></textarea>
        </div>
        <div id="importResult" style="font-size:12px;margin-bottom:10px"></div>
        <button class="btn primary" onclick="runCsvImport()">Import</button>
      </div>
    </div>`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',').map(c => c.trim());
    const row = {};
    headers.forEach((h, i) => row[h] = cells[i] || '');
    return row;
  });
}

async function runCsvImport() {
  const text = document.getElementById('csv_text').value;
  const rows = parseCsv(text);
  const resultEl = document.getElementById('importResult');
  if (!rows.length) { resultEl.textContent = 'No rows found.'; return; }
  try {
    const data = await api('/contacts/import', { method: 'POST', body: { verticalId: state.selectedVerticalId, rows } });
    resultEl.innerHTML = `✓ Imported ${data.createdCount}. Skipped ${data.skippedCount}.` +
      (data.skipped.length ? '<br>' + data.skipped.map(s => `${s.row.name || '(no name)'}: ${s.reason}`).join('<br>') : '');
    await loadVerticals();
    await loadContactsForSelectedVertical();
    renderVerticalChips();
  } catch (e) { resultEl.textContent = '⚠ ' + e.message; }
}

// ── LEADERBOARD VIEW ──
async function renderLeaderboardView() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Loading…</div>';
  const data = await api('/reports/leaderboard?days=7');
  if (!data.leaderboard.length) { content.innerHTML = '<div class="empty">No team activity yet.</div>'; return; }
  content.innerHTML = `
    <div class="banner">Last ${data.days} days · score = calls×2 + confirms×3 + tasks×1</div>
    <table class="simple">
      <tr><th>#</th><th>Name</th><th>Role</th><th>Calls Made</th><th>Contacts Confirmed</th><th>Tasks Completed</th><th>Score</th></tr>
      ${data.leaderboard.map((u, i) => `
        <tr>
          <td>${i + 1}${i === 0 ? ' 🏆' : ''}</td><td>${u.name}</td><td>${u.role}</td>
          <td>${u.callsMade}</td><td>${u.contactsConfirmed}</td><td>${u.tasksCompleted}</td>
          <td><b>${u.score}</b></td>
        </tr>`).join('')}
    </table>`;
}

// ── TASKS VIEW ──
async function renderTasksView() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty">Loading…</div>';
  state.tasks = await api('/va-tasks?status=open');
  if (!state.tasks.length) { content.innerHTML = '<div class="empty">🎉 No open tasks — every contact has complete data.</div>'; return; }
  content.innerHTML = `
    <table class="simple">
      <tr><th>Contact</th><th>Tier</th><th>Missing Field</th><th>Assigned To</th><th></th></tr>
      ${state.tasks.map(t => `
        <tr>
          <td>${t.contact.name}</td>
          <td>${t.contact.tier}</td>
          <td>${t.missingField}</td>
          <td>${t.assignedTo?.name || 'Unassigned'}</td>
          <td><button class="btn" style="font-size:11px" onclick="completeTask('${t.id}')">Mark complete</button></td>
        </tr>`).join('')}
    </table>`;
}

async function completeTask(id) {
  await api('/va-tasks/' + id + '/complete', { method: 'PATCH' });
  renderTasksView();
}

// ── VERTICALS VIEW ──
async function renderVerticalsView() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="banner">Verticals are fully custom to your company — add as many categories as your team sells into (e.g. "Architects", "Municipal Boards", "Plumbing Distributors"). Each gets its own batch size and confirm-rate rule.</div>
    <div class="toolbar">
      <input id="v_label" placeholder="New vertical name (e.g. Landscape Architects)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:220px">
      <input id="v_code" placeholder="Tag code (e.g. LAND)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:110px">
      <input id="v_batch" type="number" value="50" placeholder="Batch size" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:90px">
      <input id="v_call_script" placeholder="Call opener (optional)" style="padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;width:220px">
      <button class="btn primary" style="width:auto" onclick="addVertical()">+ Add Vertical</button>
    </div>
    <table class="simple">
      <tr><th>Vertical</th><th>Tag Code</th><th>Batch Size</th><th>Confirm Threshold</th><th>Contacts</th><th>Call Script</th></tr>
      ${state.verticals.map(v => `
        <tr>
          <td>${v.label}</td><td>${v.categoryCode}</td><td>${v.batchSize}</td>
          <td>${Math.round(v.confirmThreshold*100)}%</td><td>${v._count?.contacts ?? 0}</td>
          <td>${v.callScript ? `<button class="btn" style="font-size:11px" onclick='alert(${JSON.stringify(v.callScript)})'>View</button>` : `<button class="btn" style="font-size:11px" onclick="editScript('${v.id}')">+ Add</button>`}</td>
        </tr>`).join('')}
    </table>`;
}

async function addVertical() {
  const label = document.getElementById('v_label').value.trim();
  const categoryCode = document.getElementById('v_code').value.trim();
  const batchSize = parseInt(document.getElementById('v_batch').value) || 50;
  const callScript = document.getElementById('v_call_script').value.trim();
  if (!label || !categoryCode) return alert('Name and tag code are required.');
  try {
    await api('/verticals', { method: 'POST', body: { label, categoryCode, batchSize, callScript: callScript || null } });
    await loadVerticals();
    renderVerticalsView();
  } catch (e) { alert(e.message); }
}

async function editScript(verticalId) {
  const script = prompt('Call opener / talking points for this vertical:');
  if (script === null) return;
  await api('/verticals/' + verticalId, { method: 'PATCH', body: { callScript: script } });
  await loadVerticals();
  renderVerticalsView();
}

// ── BILLING VIEW ──
async function renderBillingView() {
  const content = document.getElementById('content');
  const status = await api('/billing/status');
  content.innerHTML = `
    <div class="stat-row">
      <div class="stat-box"><div class="n">${status.plan}</div><div class="l">Current Plan</div></div>
      <div class="stat-box"><div class="n">${status.subscriptionStatus}</div><div class="l">Status</div></div>
      ${status.trialDaysLeft !== null ? `<div class="stat-box"><div class="n">${status.trialDaysLeft}</div><div class="l">Trial Days Left</div></div>` : ''}
    </div>
    <div class="grid">
      <div class="card"><h3>Starter — $29/mo</h3><p style="font-size:12px;color:var(--mute)">3 seats, 1 territory, core features</p>
        <button class="btn primary" onclick="checkout('starter')">Upgrade to Starter</button></div>
      <div class="card"><h3>Pro — $99/mo</h3><p style="font-size:12px;color:var(--mute)">15 seats, unlimited territories, CRM sync</p>
        <button class="btn primary" onclick="checkout('pro')">Upgrade to Pro</button></div>
    </div>
    <div id="billingMsg" style="margin-top:14px;font-size:12px;color:var(--mute)"></div>
    ${renderLegalContactPanel()}`;
}

// Owner/admin-only legal & contact info — never shown outside this admin-facing panel.
function renderLegalContactPanel() {
  const role = (state.user && state.user.role) || '';
  if (role !== 'owner' && role !== 'admin') return '';
  return `
    <div class="card" style="margin-top:20px;max-width:420px">
      <h3 style="margin-top:0;font-size:13px">Legal &amp; Contact (admin only)</h3>
      <div style="font-size:12px;color:var(--mute);line-height:1.6">
        Support inbox: <a href="mailto:prospectprosupport@gmail.com">prospectprosupport@gmail.com</a><br>
        Operated by: Lighting + Controls Solutions LLC<br>
        Billing contact: Studio@LCS-Studio.com
      </div>
    </div>`;
}

async function checkout(plan) {
  const msg = document.getElementById('billingMsg');
  try {
    const data = await api('/billing/checkout', { method: 'POST', body: { plan } });
    window.location.href = data.checkoutUrl;
  } catch (e) {
    msg.textContent = '⚠ ' + e.message + ' (expected in this demo — add real Stripe keys to go live)';
  }
}

// ── Init ──
if (state.token && state.user) { boot(); }
