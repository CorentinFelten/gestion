#!/usr/bin/env node
/**
 * FR localization + market-targeting end-to-end smoke test.
 *
 * Adapted from smoke-test-postfix.mjs. Runs the full original flow (register →
 * household → invite/accept → categories → multi-currency split tx → tally →
 * reset → personal account + net worth) and layers on the localization/market
 * assertions:
 *   - new user locale defaults to fr-FR, preferredCurrency to EUR
 *   - seeded shared categories are FRENCH (Alimentation/Électricité/Loyer/Voyages)
 *   - personal account country CA → CAD, FR → EUR, country persisted/returned
 * plus a couple of retained security regressions (SEC-01 cookie, SEC-04 edit 403).
 *
 * Usage:  node scripts/smoke-test-fr.mjs [baseUrl]
 */

import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://localhost:3000/api/v1';
const PAY_DATE = '2026-03-13'; // a Friday with a published ECB rate
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'gestion-verify-db';
const DB_USER = process.env.DB_USER ?? 'gestion';
const DB_NAME = process.env.DB_NAME ?? 'gestion';

let failures = 0;
const log = (...a) => console.log(...a);
function assert(cond, msg) {
  if (cond) {
    log(`  ✓ ${msg}`);
  } else {
    failures++;
    log(`  ✗ FAIL: ${msg}`);
  }
}
function approx(a, b, tol = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

function sqlScalar(query) {
  const out = execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc', query],
    { encoding: 'utf8' },
  );
  return out.trim();
}

function makeAgent() {
  const jar = new Map();
  return {
    jar,
    async req(method, path, { body, csrf, raw, headers: extra } = {}) {
      const headers = {};
      if (!raw) headers['Content-Type'] = 'application/json';
      if (extra) Object.assign(headers, extra);
      if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      for (const c of setCookie) {
        const [pair] = c.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }
      let data = null;
      const text = await res.text();
      if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
      }
      return { status: res.status, data };
    },
  };
}

async function csrfToken(agent) {
  const { data } = await agent.req('GET', '/auth/csrf');
  return data.csrfToken;
}

async function main() {
  log(`\n=== Gestion FR localization smoke @ ${BASE} ===\n`);

  const health = await makeAgent().req('GET', '/health');
  assert(health.status === 200, `GET /health -> 200 (${health.status})`);

  const A = makeAgent();
  const B = makeAgent();
  const stamp = Date.now();
  const emailA = `alice+${stamp}@example.com`;
  const emailB = `bob+${stamp}@example.com`;

  // 1. CSRF + register A (no preferredCurrency/locale supplied → defaults)
  const csrfA = await csrfToken(A);
  assert(!!csrfA, 'GET /auth/csrf issued a token');
  const regA = await A.req('POST', '/auth/register', {
    csrf: csrfA,
    body: { email: emailA, password: 'Sup3rSecret!', displayName: 'Alice' },
  });
  assert(regA.status === 201 || regA.status === 200, `register A -> ${regA.status}`);
  const userA = regA.data.user;
  assert(!!userA?.id, 'register A returned a user id');

  // ── LOCALIZATION: new-user defaults ──────────────────────────────────────
  log(`\n--- Localization: new-user defaults ---\n`);
  log(`    A.locale = ${userA?.locale} , A.preferredCurrency = ${userA?.preferredCurrency}`);
  assert(userA?.locale === 'fr-FR', `new user locale defaults to fr-FR (${userA?.locale})`);
  assert(userA?.preferredCurrency === 'EUR', `new user preferredCurrency defaults to EUR (${userA?.preferredCurrency})`);

  // CSRF negative control
  const noCsrf = await A.req('POST', '/households', { body: { name: 'ShouldFail', baseCurrency: 'EUR' } });
  assert(noCsrf.status === 403, `POST /households without CSRF -> 403 (${noCsrf.status})`);

  // 2. Create household (base EUR)
  const hh = await A.req('POST', '/households', {
    csrf: csrfA,
    body: { name: 'Smoke Household', baseCurrency: 'EUR' },
  });
  assert(hh.status === 201 || hh.status === 200, `create household -> ${hh.status}`);
  const householdId = hh.data.id;
  assert(hh.data.baseCurrency === 'EUR', 'household base currency is EUR');

  // 3. Register B first, in-app invites target an existing registered user by id.
  const csrfB = await csrfToken(B);
  const regB = await B.req('POST', '/auth/register', {
    csrf: csrfB,
    body: { email: emailB, password: 'Sup3rSecret!', displayName: 'Bob', preferredCurrency: 'EUR' },
  });
  assert(regB.status === 201 || regB.status === 200, `register B -> ${regB.status}`);
  const userB = regB.data.user;
  assert(!!userB?.id, 'register B returned a user id');

  // 4. A invites B by user id; B accepts from their pending invites.
  const invitable = await A.req('GET', `/households/${householdId}/invitable-users`);
  assert(
    invitable.status === 200 && invitable.data.some((u) => u.id === userB.id),
    'B appears in invitable-users',
  );
  const inv = await A.req('POST', `/households/${householdId}/invites`, {
    csrf: csrfA,
    body: { invitedUserId: userB.id, role: 'member' },
  });
  assert(inv.status === 201 || inv.status === 200, `invite B -> ${inv.status}`);

  const mine = await B.req('GET', '/me/invites');
  assert(mine.status === 200 && mine.data.length === 1, `B has 1 pending invite (${mine.data?.length})`);
  const inviteId = mine.data[0].id;
  const acc = await B.req('POST', `/invites/${inviteId}/accept`, { csrf: csrfB });
  assert(acc.status === 201 || acc.status === 200, `B accept invite -> ${acc.status}`);

  const members = await A.req('GET', `/households/${householdId}/members`);
  assert(members.data.length === 2, `household has 2 members (${members.data.length})`);

  // 5. GET categories, assert FRENCH seeded categories
  log(`\n--- Localization: French seeded categories ---\n`);
  const cats = await A.req('GET', `/households/${householdId}/categories`);
  assert(cats.status === 200, `GET categories -> ${cats.status}`);
  assert(Array.isArray(cats.data) && cats.data.length >= 10, `seeded shared categories (${cats.data?.length})`);
  const names = new Set((cats.data ?? []).map((c) => c.name));
  log(`    category names = ${[...names].join(', ')}`);
  for (const fr of ['Alimentation', 'Électricité', 'Loyer', 'Voyages']) {
    assert(names.has(fr), `French category "${fr}" present`);
  }
  assert(!names.has('Groceries'), 'English "Groceries" category is NOT present');
  assert(!names.has('Rent') && !names.has('Travel'), 'no English "Rent"/"Travel" categories');
  const groceries = cats.data.find((c) => c.name === 'Alimentation');
  assert(!!groceries, 'default "Alimentation" category resolved for tx flow');

  // 6. 120 USD tx, equal split A/B, paid by A (frozen FX)
  const tx = await A.req('POST', `/households/${householdId}/transactions`, {
    csrf: csrfA,
    body: {
      payerUserId: userA.id,
      description: 'Hotel in the US',
      categoryId: groceries.id,
      amountOriginal: '120',
      currencyOriginal: 'USD',
      paymentDate: PAY_DATE,
      splits: [
        { userId: userA.id, splitType: 'equal', shareValue: '1' },
        { userId: userB.id, splitType: 'equal', shareValue: '1' },
      ],
    },
  });
  assert(tx.status === 201 || tx.status === 200, `create USD transaction -> ${tx.status}`);
  const txId = tx.data.id;
  const amountBase = Number(tx.data.amountBase);
  log(`    120 USD -> ${tx.data.amountBase} EUR @ rate ${tx.data.fxRate} (${tx.data.fxRateDate})`);
  assert(approx(amountBase, 104.5656, 0.001), `frozen multi-currency base = 104.5656 (${amountBase})`);
  const halfBase = amountBase / 2;

  // 7. Tally before reset
  const tallyA = await A.req('GET', `/households/${householdId}/tally?me=1`);
  assert(tallyA.status === 200, `GET tally (A) -> ${tallyA.status}`);
  const cellB = tallyA.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  assert(cellB && approx(cellB.net, halfBase), `B owes A ~half (${cellB?.net} ~ ${halfBase.toFixed(2)})`);

  const prefill = await A.req(
    'GET',
    `/households/${householdId}/categories/${groceries.id}/settle-up?from=${userB.id}&to=${userA.id}`,
  );
  const outstanding = prefill.data.outstandingBase;
  assert(approx(outstanding, halfBase), `prefill outstanding ~ half (${outstanding})`);

  // 8. POST reset settlement
  const csrfB2 = await csrfToken(B);
  const settle = await B.req('POST', `/households/${householdId}/settlements`, {
    csrf: csrfB2,
    body: {
      fromUserId: userB.id,
      toUserId: userA.id,
      categoryId: groceries.id,
      amountOriginal: outstanding,
      currencyOriginal: 'EUR',
      paymentDate: PAY_DATE,
      note: 'Reset groceries tally',
    },
  });
  assert(settle.status === 201 || settle.status === 200, `POST reset settlement -> ${settle.status}`);
  assert(settle.data.isFullReset === true, `settlement flagged is_full_reset (${settle.data.isFullReset})`);

  // 9. Tally after reset → 0
  const tally2 = await A.req('GET', `/households/${householdId}/tally?me=1`);
  const cellB2 = tally2.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  const net2 = cellB2 ? Number(cellB2.net) : 0;
  log(`    tally after reset net = ${net2} (expected 0)`);
  assert(approx(net2, 0), `tally cleared after reset (${net2})`);

  // 10. Personal ledger for A → net worth
  const acctRes = await A.req('POST', '/me/accounts', {
    csrf: csrfA,
    body: { name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1000' },
  });
  assert(acctRes.status === 201 || acctRes.status === 200, `create personal account -> ${acctRes.status}`);
  const acctId = acctRes.data.id;
  const inc = await A.req('POST', '/me/transactions', {
    csrf: csrfA,
    body: { accountId: acctId, type: 'income', amount: '2500', txnDate: PAY_DATE, payeeSource: 'Employer' },
  });
  assert(inc.status === 201 || inc.status === 200, `personal income -> ${inc.status}`);
  const exp = await A.req('POST', '/me/transactions', {
    csrf: csrfA,
    body: { accountId: acctId, type: 'expense', amount: '400', txnDate: PAY_DATE, payeeSource: 'Rent' },
  });
  assert(exp.status === 201 || exp.status === 200, `personal expense -> ${exp.status}`);

  // 11. Net worth
  const nw = await A.req('GET', '/me/net-worth');
  assert(nw.status === 200, `GET /me/net-worth -> ${nw.status}`);
  log(`    net worth total = ${nw.data.total} ${nw.data.profileCurrency} (expected 3100)`);
  assert(approx(nw.data.total, 3100, 0.01), `net worth = 3100 (${nw.data.total})`);

  // ── MARKET: per-account country → default currency ───────────────────────
  log(`\n--- Market: per-account country → default currency ---\n`);
  // CA, no currency → CAD
  const caAcct = await A.req('POST', '/me/accounts', {
    csrf: csrfA,
    body: { name: 'Compte CA', type: 'checking', country: 'CA' },
  });
  assert(caAcct.status === 201 || caAcct.status === 200, `create CA account (no currency) -> ${caAcct.status}`);
  log(`    CA account: currency=${caAcct.data?.currency} country=${caAcct.data?.country}`);
  assert(caAcct.data?.currency === 'CAD', `CA account currency defaults to CAD (${caAcct.data?.currency})`);
  assert(caAcct.data?.country === 'CA', `CA account country persisted/returned (${caAcct.data?.country})`);

  // FR, no currency → EUR
  const frAcct = await A.req('POST', '/me/accounts', {
    csrf: csrfA,
    body: { name: 'Compte FR', type: 'checking', country: 'FR' },
  });
  assert(frAcct.status === 201 || frAcct.status === 200, `create FR account (no currency) -> ${frAcct.status}`);
  log(`    FR account: currency=${frAcct.data?.currency} country=${frAcct.data?.country}`);
  assert(frAcct.data?.currency === 'EUR', `FR account currency defaults to EUR (${frAcct.data?.currency})`);
  assert(frAcct.data?.country === 'FR', `FR account country persisted/returned (${frAcct.data?.country})`);

  // account with no country at all → defaults country FR / currency EUR
  const defAcct = await A.req('POST', '/me/accounts', {
    csrf: csrfA,
    body: { name: 'Compte défaut', type: 'checking' },
  });
  assert(defAcct.data?.country === 'FR' && defAcct.data?.currency === 'EUR',
    `no-country account defaults FR/EUR (${defAcct.data?.country}/${defAcct.data?.currency})`);

  // ═══════════════════════════════════════════════════════════════════════
  //  RETAINED SECURITY REGRESSIONS
  // ═══════════════════════════════════════════════════════════════════════
  log(`\n--- Security regression assertions ---\n`);

  // SEC-01: session cookie is base64url CSPRNG (43 chars = 32 bytes), not a cuid.
  const sessCookie = A.jar.get('gestion_session');
  log(`    gestion_session = ${sessCookie}`);
  assert(
    typeof sessCookie === 'string' && /^[A-Za-z0-9_-]{43}$/.test(sessCookie),
    `SEC-01: session cookie matches ^[A-Za-z0-9_-]{43}$ (len ${sessCookie?.length})`,
  );
  assert(!/^c[a-z0-9]{24}$/.test(sessCookie), 'SEC-01: session cookie is NOT a 25-char cuid');

  // SEC-04: a plain member (B, not creator/payer/admin) CANNOT edit A's tx.
  const csrfB3 = await csrfToken(B);
  const bEdit = await B.req('PATCH', `/transactions/${txId}`, {
    csrf: csrfB3,
    body: { description: 'Bob tampering' },
  });
  log(`    non-creator B edit status = ${bEdit.status}`);
  assert(bEdit.status === 403, `SEC-04: non-creator member B edit tx -> 403 (${bEdit.status})`);

  // sanity: creator A CAN edit
  const aEdit = await A.req('PATCH', `/transactions/${txId}`, {
    csrf: csrfA,
    body: { description: 'Hotel in the US (edited)' },
  });
  assert(aEdit.status === 200, `SEC-04: creator/payer A can edit tx -> ${aEdit.status}`);

  log(`\n=== ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(2);
});
