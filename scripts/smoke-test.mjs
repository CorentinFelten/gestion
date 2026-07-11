#!/usr/bin/env node
/**
 * End-to-end smoke test for the Gestion stack (PLAN.md §6/§9).
 *
 * Drives the REAL API through `/api/v1`:
 *   GET /auth/csrf → register A → create household (EUR) → register B → A invites B (in-app, by user id) → B accepts
 *   → GET categories → create a 120 USD transaction split equally A/B
 *   → assert tally (B owes A ~half in EUR) → reset settlement → assert cleared
 *   → personal account + income + expense → GET /me/net-worth.
 *
 * Usage:  node scripts/smoke-test.mjs [baseUrl]
 *   baseUrl defaults to http://localhost:3000/api/v1
 */

const BASE = process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://localhost:3000/api/v1';
const PAY_DATE = '2026-03-13'; // a Friday with a published ECB rate

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

/** Minimal cookie-jar HTTP agent (one per simulated browser/user). */
function makeAgent() {
  const jar = new Map();
  return {
    jar,
    async req(method, path, { body, csrf } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
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

/** Fetch a CSRF token into the agent's jar, return it for the header. */
async function csrfToken(agent) {
  const { data } = await agent.req('GET', '/auth/csrf');
  return data.csrfToken;
}

async function main() {
  log(`\n=== Gestion smoke test @ ${BASE} ===\n`);

  // 0. Health
  const health = await makeAgent().req('GET', '/health');
  assert(health.status === 200, `GET /health → 200 (${health.status})`);

  const A = makeAgent();
  const B = makeAgent();
  const stamp = Date.now();
  const emailA = `alice+${stamp}@example.com`;
  const emailB = `bob+${stamp}@example.com`;

  // 1. CSRF + register A
  const csrfA = await csrfToken(A);
  assert(!!csrfA, 'GET /auth/csrf issued a token');
  const regA = await A.req('POST', '/auth/register', {
    csrf: csrfA,
    body: { email: emailA, password: 'Sup3rSecret!', displayName: 'Alice', preferredCurrency: 'EUR' },
  });
  assert(regA.status === 201 || regA.status === 200, `register A → ${regA.status}`);
  const userA = regA.data.user;
  assert(!!userA?.id, 'register A returned a user id');

  // CSRF negative control: mutating request without the header must be rejected.
  const noCsrf = await A.req('POST', '/households', {
    body: { name: 'ShouldFail', baseCurrency: 'EUR' },
  });
  assert(noCsrf.status === 403, `POST /households without CSRF → 403 (${noCsrf.status})`);

  // 2. Create household (base EUR)
  const hh = await A.req('POST', '/households', {
    csrf: csrfA,
    body: { name: 'Smoke Household', baseCurrency: 'EUR' },
  });
  assert(hh.status === 201 || hh.status === 200, `create household → ${hh.status}`);
  const householdId = hh.data.id;
  assert(hh.data.baseCurrency === 'EUR', 'household base currency is EUR');

  // 3. Register B first, in-app invites target an existing registered user by id.
  const csrfB = await csrfToken(B);
  const regB = await B.req('POST', '/auth/register', {
    csrf: csrfB,
    body: { email: emailB, password: 'Sup3rSecret!', displayName: 'Bob', preferredCurrency: 'EUR' },
  });
  assert(regB.status === 201 || regB.status === 200, `register B → ${regB.status}`);
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
  assert(inv.status === 201 || inv.status === 200, `invite B → ${inv.status}`);

  const mine = await B.req('GET', '/me/invites');
  assert(mine.status === 200 && mine.data.length === 1, `B has 1 pending invite (${mine.data?.length})`);
  const inviteId = mine.data[0].id;
  const acc = await B.req('POST', `/invites/${inviteId}/accept`, { csrf: csrfB });
  assert(acc.status === 201 || acc.status === 200, `B accept invite → ${acc.status}`);

  const members = await A.req('GET', `/households/${householdId}/members`);
  assert(members.data.length === 2, `household has 2 members (${members.data.length})`);

  // 5. GET categories (member-gated) + seeded defaults
  const cats = await A.req('GET', `/households/${householdId}/categories`);
  assert(cats.status === 200, `GET categories → ${cats.status}`);
  assert(Array.isArray(cats.data) && cats.data.length >= 10, `seeded shared categories (${cats.data?.length})`);
  const groceries = cats.data.find((c) => c.name === 'Alimentation');
  assert(!!groceries, 'default "Alimentation" category present');

  // Authz control: B cannot read A's personal ledger (owner-only /me).
  // (Covered implicitly, /me/* uses the session user; no cross-user param exists.)

  // 6. Create a 120 USD transaction, equal split A/B, paid by A, category Groceries
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
  assert(tx.status === 201 || tx.status === 200, `create USD transaction → ${tx.status}`);
  const amountBase = Number(tx.data.amountBase);
  log(`    120 USD → ${tx.data.amountBase} EUR @ rate ${tx.data.fxRate} (${tx.data.fxRateDate})`);
  assert(amountBase > 0 && amountBase < 120, `amount converted to EUR base (${amountBase})`);
  const halfBase = amountBase / 2;

  // Authz control: an unrelated logged-in user cannot read this tx by id.
  const csrfB2 = await csrfToken(B); // refresh (B is a member, should succeed)
  const bReadsTx = await B.req('GET', `/transactions/${tx.data.id}`);
  assert(bReadsTx.status === 200, `member B can GET /transactions/:id → ${bReadsTx.status}`);
  // Simulate a stranger (fresh user C not in the household).
  const C = makeAgent();
  const csrfC = await csrfToken(C);
  await C.req('POST', '/auth/register', {
    csrf: csrfC,
    body: { email: `carol+${stamp}@example.com`, password: 'Sup3rSecret!', displayName: 'Carol' },
  });
  const cReadsTx = await C.req('GET', `/transactions/${tx.data.id}`);
  assert(cReadsTx.status === 404, `non-member C GET /transactions/:id → 404 (${cReadsTx.status})`);

  // 7. Tally before reset, B should owe A ~half in EUR (Groceries)
  const tallyA = await A.req('GET', `/households/${householdId}/tally?me=1`);
  assert(tallyA.status === 200, `GET tally (A) → ${tallyA.status}`);
  const cellB = tallyA.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  log(`    tally(A) Groceries vs Bob: net = ${cellB?.net} EUR (expected +${halfBase.toFixed(2)})`);
  assert(cellB && approx(cellB.net, halfBase), `B owes A ~half (${cellB?.net} ≈ ${halfBase.toFixed(2)})`);

  // Prefill exact outstanding for the reset (from=B debtor, to=A creditor)
  const prefill = await A.req(
    'GET',
    `/households/${householdId}/categories/${groceries.id}/settle-up?from=${userB.id}&to=${userA.id}`,
  );
  const outstanding = prefill.data.outstandingBase;
  log(`    settle-up prefill outstanding = ${outstanding} EUR`);
  assert(approx(outstanding, halfBase), `prefill outstanding ≈ half (${outstanding})`);

  // 8. POST reset settlement (B pays A the outstanding, in EUR)
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
  assert(settle.status === 201 || settle.status === 200, `POST reset settlement → ${settle.status}`);
  assert(settle.data.isFullReset === true, `settlement flagged is_full_reset (${settle.data.isFullReset})`);

  // 9. Tally after reset, Groceries pair cleared
  const tally2 = await A.req('GET', `/households/${householdId}/tally?me=1`);
  const cellB2 = tally2.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  const net2 = cellB2 ? Number(cellB2.net) : 0;
  log(`    tally(A) Groceries vs Bob after reset: net = ${net2} EUR (expected 0)`);
  assert(approx(net2, 0), `Groceries tally cleared after reset (${net2})`);

  // 10. Personal ledger for A: account + income + expense
  const acctRes = await A.req('POST', '/me/accounts', {
    csrf: csrfA,
    body: { name: 'Checking', type: 'checking', currency: 'EUR', openingBalance: '1000' },
  });
  assert(acctRes.status === 201 || acctRes.status === 200, `create personal account → ${acctRes.status}`);
  const acctId = acctRes.data.id;

  const inc = await A.req('POST', '/me/transactions', {
    csrf: csrfA,
    body: { accountId: acctId, type: 'income', amount: '2500', txnDate: PAY_DATE, payeeSource: 'Employer' },
  });
  assert(inc.status === 201 || inc.status === 200, `personal income → ${inc.status}`);
  const exp = await A.req('POST', '/me/transactions', {
    csrf: csrfA,
    body: { accountId: acctId, type: 'expense', amount: '400', txnDate: PAY_DATE, payeeSource: 'Rent' },
  });
  assert(exp.status === 201 || exp.status === 200, `personal expense → ${exp.status}`);

  // 11. Net worth = 1000 + 2500 - 400 = 3100 EUR
  const nw = await A.req('GET', '/me/net-worth');
  assert(nw.status === 200, `GET /me/net-worth → ${nw.status}`);
  log(`    net worth total = ${nw.data.total} ${nw.data.profileCurrency} (expected 3100)`);
  assert(approx(nw.data.total, 3100, 0.01), `net worth = 3100 (${nw.data.total})`);

  // Personal categories endpoint (global defaults)
  const pcats = await A.req('GET', '/categories');
  assert(pcats.status === 200 && pcats.data.length > 0, `GET /categories (personal defaults) → ${pcats.data?.length}`);

  log(`\n=== ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(2);
});
