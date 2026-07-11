#!/usr/bin/env node
/**
 * Post-security-fix end-to-end smoke test + security regression suite.
 *
 * Runs the full original smoke flow (register A → login → household → invite+accept
 * B → categories → multi-currency split tx → tally → reset → tally cleared →
 * personal account + income/expense → net worth) and then adds explicit regression
 * assertions for the merged security fixes SEC-01/03/04/05/10/11.
 *
 * Usage:  node scripts/smoke-test-postfix.mjs [baseUrl]
 *   baseUrl defaults to http://localhost:3000/api/v1
 *   DB_CONTAINER (default gestion-smoke-db) is the postgres container for audit SQL.
 */

import { execFileSync } from 'node:child_process';

const BASE = process.argv[2] ?? process.env.SMOKE_BASE ?? 'http://localhost:3000/api/v1';
const PAY_DATE = '2026-03-13'; // a Friday with a published ECB rate
const DB_CONTAINER = process.env.DB_CONTAINER ?? 'gestion-smoke-db';
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

/** Run a scalar SQL query against the throwaway postgres container. */
function sqlScalar(query) {
  const out = execFileSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', DB_USER, '-d', DB_NAME, '-tAc', query],
    { encoding: 'utf8' },
  );
  return out.trim();
}

/** Minimal cookie-jar HTTP agent (one per simulated browser/user). */
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
  log(`\n=== Gestion post-fix smoke + security regression @ ${BASE} ===\n`);

  // 0. Health
  const health = await makeAgent().req('GET', '/health');
  assert(health.status === 200, `GET /health -> 200 (${health.status})`);

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
  assert(regA.status === 201 || regA.status === 200, `register A -> ${regA.status}`);
  const userA = regA.data.user;
  assert(!!userA?.id, 'register A returned a user id');

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

  // 5. GET categories
  const cats = await A.req('GET', `/households/${householdId}/categories`);
  assert(cats.status === 200, `GET categories -> ${cats.status}`);
  assert(Array.isArray(cats.data) && cats.data.length >= 10, `seeded shared categories (${cats.data?.length})`);
  const groceries = cats.data.find((c) => c.name === 'Alimentation');
  assert(!!groceries, 'default "Alimentation" category present');

  // 6. Create a 120 USD transaction, equal split A/B, paid by A
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
  assert(amountBase > 0 && amountBase < 120, `amount converted to EUR base (${amountBase})`);
  assert(approx(amountBase, 104.5656, 0.001), `frozen multi-currency base = 104.5656 (${amountBase})`);
  const halfBase = amountBase / 2;

  // member/stranger read controls
  const bReadsTx = await B.req('GET', `/transactions/${txId}`);
  assert(bReadsTx.status === 200, `member B can GET /transactions/:id -> ${bReadsTx.status}`);
  const C = makeAgent();
  const csrfC = await csrfToken(C);
  await C.req('POST', '/auth/register', {
    csrf: csrfC,
    body: { email: `carol+${stamp}@example.com`, password: 'Sup3rSecret!', displayName: 'Carol' },
  });
  const cReadsTx = await C.req('GET', `/transactions/${txId}`);
  assert(cReadsTx.status === 404, `non-member C GET /transactions/:id -> 404 (${cReadsTx.status})`);

  // 7. Tally before reset
  const tallyA = await A.req('GET', `/households/${householdId}/tally?me=1`);
  assert(tallyA.status === 200, `GET tally (A) -> ${tallyA.status}`);
  const cellB = tallyA.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  log(`    tally(A) Groceries vs Bob: net = ${cellB?.net} EUR (expected +${halfBase.toFixed(2)})`);
  assert(cellB && approx(cellB.net, halfBase), `B owes A ~half (${cellB?.net} ~ ${halfBase.toFixed(2)})`);

  const prefill = await A.req(
    'GET',
    `/households/${householdId}/categories/${groceries.id}/settle-up?from=${userB.id}&to=${userA.id}`,
  );
  const outstanding = prefill.data.outstandingBase;
  log(`    settle-up prefill outstanding = ${outstanding} EUR`);
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

  // 9. Tally after reset
  const tally2 = await A.req('GET', `/households/${householdId}/tally?me=1`);
  const cellB2 = tally2.data.cells.find((c) => c.otherUserId === userB.id && c.categoryId === groceries.id);
  const net2 = cellB2 ? Number(cellB2.net) : 0;
  log(`    tally(A) Groceries vs Bob after reset: net = ${net2} EUR (expected 0)`);
  assert(approx(net2, 0), `Groceries tally cleared after reset (${net2})`);

  // 10. Personal ledger for A
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  SECURITY REGRESSION ASSERTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  log(`\n--- Security regression assertions ---\n`);

  // SEC-01: session cookie is base64url CSPRNG (43 chars = 32 bytes), not a cuid.
  const sessCookie = A.jar.get('gestion_session');
  log(`    gestion_session = ${sessCookie}`);
  assert(
    typeof sessCookie === 'string' && /^[A-Za-z0-9_-]{43}$/.test(sessCookie),
    `SEC-01: session cookie matches ^[A-Za-z0-9_-]{43}$ (len ${sessCookie?.length})`,
  );
  assert(!/^c[a-z0-9]{24}$/.test(sessCookie), 'SEC-01: session cookie is NOT a 25-char cuid');

  // SEC-04: audit_log row exists for the created transaction.
  const createdAudits = Number(sqlScalar(
    `SELECT count(*) FROM audit_log WHERE entity='transaction' AND entity_id='${txId}' AND action='transaction.created'`,
  ));
  assert(createdAudits >= 1, `SEC-04: audit_log has a transaction.created row for the tx (${createdAudits})`);

  // SEC-04: creator/payer (A) CAN edit; audit_log gains an updated row.
  const aEdit = await A.req('PATCH', `/transactions/${txId}`, {
    csrf: csrfA,
    body: { description: 'Hotel in the US (edited)' },
  });
  assert(aEdit.status === 200, `SEC-04: creator/payer A can edit tx -> ${aEdit.status}`);
  const updatedAudits = Number(sqlScalar(
    `SELECT count(*) FROM audit_log WHERE entity='transaction' AND entity_id='${txId}' AND action='transaction.updated'`,
  ));
  assert(updatedAudits >= 1, `SEC-04: audit_log has a transaction.updated row after edit (${updatedAudits})`);

  // SEC-04: a plain member (B, not creator/payer/admin) CANNOT edit or delete A's tx.
  const csrfB3 = await csrfToken(B);
  const bEdit = await B.req('PATCH', `/transactions/${txId}`, {
    csrf: csrfB3,
    body: { description: 'Bob tampering' },
  });
  assert(bEdit.status === 403 || bEdit.status === 404, `SEC-04: non-creator member B edit tx -> ${bEdit.status} (want 403/404)`);
  const bDel = await B.req('DELETE', `/transactions/${txId}`, { csrf: csrfB3 });
  assert(bDel.status === 403 || bDel.status === 404, `SEC-04: non-creator member B delete tx -> ${bDel.status} (want 403/404)`);

  // Invite authz (replaces the old SEC-03 email-binding test, invites are now
  // in-app and target a user id): only the invited user may accept an invite.
  const Dave = makeAgent();
  const csrfDave = await csrfToken(Dave);
  const daveReg = await Dave.req('POST', '/auth/register', {
    csrf: csrfDave,
    body: { email: `dave+${stamp}@example.com`, password: 'Sup3rSecret!', displayName: 'Dave' },
  });
  assert(daveReg.status === 201, `register dave -> ${daveReg.status}`);
  const daveId = daveReg.data.user.id;
  const inv2 = await A.req('POST', `/households/${householdId}/invites`, {
    csrf: csrfA,
    body: { invitedUserId: daveId, role: 'member' },
  });
  assert(inv2.status === 201 || inv2.status === 200, `invite dave -> ${inv2.status}`);
  const daveInvites = await Dave.req('GET', '/me/invites');
  const daveInviteId = daveInvites.data[0]?.id;
  assert(!!daveInviteId, 'dave has a pending invite');
  // C (a registered user who is NOT the invitee) cannot redeem Dave's invite.
  const csrfC2 = await csrfToken(C);
  const mismatchAccept = await C.req('POST', `/invites/${daveInviteId}/accept`, { csrf: csrfC2 });
  assert(mismatchAccept.status === 404 || mismatchAccept.status === 403, `invite authz: non-invitee accept rejected -> ${mismatchAccept.status} (want 404/403)`);
  // Dave (the invited user) can redeem it.
  const daveAccept = await Dave.req('POST', `/invites/${daveInviteId}/accept`, { csrf: csrfDave });
  assert(daveAccept.status === 201 || daveAccept.status === 200, `invitee accept works -> ${daveAccept.status}`);

  // SEC-11: shared tx with a category from ANOTHER household is rejected.
  // Reuse C (a registered user not in household1) to own a second household,
  // avoids extra registrations that would trip the 5/min auth throttle.
  const csrfC3 = await csrfToken(C);
  const hh2 = await C.req('POST', '/households', {
    csrf: csrfC3,
    body: { name: 'Other Household', baseCurrency: 'EUR' },
  });
  assert(hh2.status === 201, `SEC-11: second household created -> ${hh2.status}`);
  const hh2Cats = await C.req('GET', `/households/${hh2.data.id}/categories`);
  const foreignCat = hh2Cats.data.find((c) => c.householdId === hh2.data.id) ?? hh2Cats.data.find((c) => c.name === 'Groceries');
  const crossTx = await A.req('POST', `/households/${householdId}/transactions`, {
    csrf: csrfA,
    body: {
      payerUserId: userA.id,
      description: 'cross-household category',
      categoryId: foreignCat.id,
      amountOriginal: '10',
      currencyOriginal: 'EUR',
      paymentDate: PAY_DATE,
      splits: [{ userId: userA.id, splitType: 'equal', shareValue: '1' }],
    },
  });
  assert(crossTx.status === 400, `SEC-11: tx with another household's category rejected -> ${crossTx.status} (want 400)`);

  // SEC-05: force a non-HttpException (numeric overflow) -> generic body, no internals.
  const overflow = await A.req('POST', `/households/${householdId}/transactions`, {
    csrf: csrfA,
    body: {
      payerUserId: userA.id,
      description: 'overflow',
      categoryId: groceries.id,
      amountOriginal: '999999999999999', // exceeds NUMERIC(20,6) integer capacity
      currencyOriginal: 'EUR',
      paymentDate: PAY_DATE,
      splits: [{ userId: userA.id, splitType: 'equal', shareValue: '1' }],
    },
  });
  assert(overflow.status >= 500, `SEC-05: forced internal error -> ${overflow.status} (>=500)`);
  const body500 = JSON.stringify(overflow.data ?? {});
  log(`    500 body = ${body500}`);
  assert(overflow.data?.message === 'Internal server error', `SEC-05: generic message returned (${overflow.data?.message})`);
  assert(!/prisma|numeric|overflow|constraint|column|P20\d\d|at .*\.ts/i.test(body500), 'SEC-05: body leaks no Prisma/DB/internal strings');

  // SEC-10: attachment with a disallowed MIME is rejected (400).
  const form = new FormData();
  form.append('file', new Blob(['<html>evil</html>'], { type: 'text/html' }), 'evil.html');
  const badUpload = await A.req('POST', `/transactions/${txId}/attachments`, {
    csrf: csrfA,
    raw: form,
  });
  assert(badUpload.status === 400, `SEC-10: disallowed MIME (text/html) attachment -> ${badUpload.status} (want 400)`);

  log(`\n=== ${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(2);
});
