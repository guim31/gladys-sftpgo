// -----------------------------------------------------------------------------
// The SFTPGo client: the real answers of SFTPGo 2.7.6 (test/fixtures/sftpgo),
// authentication (token, API key), errors, the event log and its cursor, and
// the parsing of the address typed by the user.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  EVENT_LOG,
  PAGE_SIZE,
  SftpgoClient,
  normalizeConnection,
  normalizeLoginFailure,
  normalizeUpload,
  normalizeUser,
} from '../src/sftpgo/client.js';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import { ADMIN, API_KEY, BASE, FakeSftpgo, PASSWORD } from './helpers/fakeSftpgo.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/sftpgo/${name}`, import.meta.url), 'utf8'));

const clientOf = (fake, extra = {}) =>
  new SftpgoClient({
    url: BASE,
    username: ADMIN,
    password: PASSWORD,
    request: fake.request,
    now: fake.now,
    ...extra,
  });

test('real users: quotas, tracked or not (SFTPGo omits the zero values)', async () => {
  const users = (await fixture('users.json')).map(normalizeUser);
  const scanner = users.find((u) => u.username === 'scanner');
  const phone = users.find((u) => u.username === 'phone');
  assert.equal(scanner.quotaSize, 10_485_760);
  assert.equal(scanner.usedSize, 6_000_000);
  assert.equal(scanner.usedFiles, 2);
  assert.equal(scanner.quotaTracked, true);
  // No quota: SFTPGo does not track it by default (track_quota 2).
  assert.equal(phone.quotaSize, 0);
  assert.equal(phone.usedSize, 0);
  assert.equal(phone.quotaTracked, false);
});

test('real connections: protocol and transfers running', async () => {
  const connections = (await fixture('connections.json')).map(normalizeConnection);
  const dav = connections.find((c) => c.protocol === 'DAV');
  assert.equal(dav.username, 'phone');
  assert.equal(dav.uploads, 1);
  assert.equal(dav.downloads, 0);
});

test('real upload events: path, folder, extension, size, nanoseconds to milliseconds', async () => {
  const uploads = (await fixture('events-fs.json')).map(normalizeUpload);
  const scan = uploads.find((u) => u.path === '/scan-001.pdf');
  assert.equal(scan.username, 'scanner');
  assert.equal(scan.folder, '/');
  assert.equal(scan.fileName, 'scan-001.pdf');
  assert.equal(scan.extension, 'pdf');
  assert.equal(scan.size, 3_000_000);
  assert.equal(scan.protocol, 'SFTP');
  assert.equal(scan.time, 1792684883503);
  const photo = uploads.find((u) => u.protocol === 'DAV');
  assert.equal(photo.path, '/photo.jpg');
  const nested = uploads.find((u) => u.path === '/docs/scan');
  assert.equal(nested.folder, '/docs');
  assert.equal(nested.extension, '');
});

test('real login events: the failures, unknown user or not', async () => {
  const failures = (await fixture('events-logs.json')).map(normalizeLoginFailure);
  assert.equal(failures.length, 3);
  assert.deepEqual(
    failures.map((f) => [f.username, f.protocol, f.unknownUser]),
    [
      ['phone', 'DAV', false],
      ['scanner', 'SSH', false],
      ['scanner', 'SSH', false],
    ],
  );
  assert.equal(failures[0].message, 'invalid credentials');
});

test('a token is asked once, renewed before it expires, and again when refused', async () => {
  let time = Date.UTC(2026, 9, 22, 8);
  const fake = new FakeSftpgo({ now: () => time });
  fake.addUser('scanner');
  const client = clientOf(fake);
  await client.users();
  await client.connections();
  assert.equal(fake.calls.filter((c) => c === '/api/v2/token').length, 1);
  time += 19 * 60_000; // 20 minutes of life, renewed 2 minutes before
  await client.users();
  assert.equal(fake.calls.filter((c) => c === '/api/v2/token').length, 2);
  fake.tokens.clear(); // SFTPGo restarted
  assert.equal((await client.users()).length, 1);
  assert.equal(fake.calls.filter((c) => c === '/api/v2/token').length, 3);
});

test('an API key goes in its header, without token', async () => {
  const fake = new FakeSftpgo();
  fake.addUser('scanner');
  const client = clientOf(fake, { apiKey: API_KEY, username: '', password: '' });
  assert.equal((await client.users()).length, 1);
  assert.ok(!fake.calls.includes('/api/v2/token'));
  const wrong = clientOf(fake, { apiKey: 'nope.nope' });
  await assert.rejects(wrong.users(), { kind: ERROR_KINDS.AUTH });
});

test('errors: credentials, permission, unreachable, redirect, not SFTPGo', async () => {
  const fake = new FakeSftpgo();
  await assert.rejects(clientOf(fake, { password: 'wrong' }).users(), { kind: ERROR_KINDS.AUTH });
  fake.permissions.delete('view_conns');
  await assert.rejects(clientOf(fake).connections(), { kind: ERROR_KINDS.FORBIDDEN });
  fake.down = true;
  await assert.rejects(clientOf(fake).users(), { kind: ERROR_KINDS.UNREACHABLE });
  const answer = (response) => clientOf(fake, { request: async () => response }).version();
  await assert.rejects(answer({ status: 302, headers: {}, body: '' }), {
    kind: ERROR_KINDS.REDIRECT,
  });
  await assert.rejects(answer({ status: 200, headers: {}, body: '<html>' }), {
    kind: ERROR_KINDS.NOT_SFTPGO,
  });
  await assert.rejects(answer({ status: 404, headers: {}, body: '' }), {
    kind: ERROR_KINDS.NOT_SFTPGO,
  });
  await assert.rejects(
    answer({ status: 200, headers: {}, body: JSON.stringify({ access_token: 'x' }) }),
    { kind: ERROR_KINDS.NOT_SFTPGO },
  );
});

test('the event log: missing without the plugin (HTTP 501), refused without view_events', async () => {
  const body = JSON.stringify(await fixture('no-plugin.json'));
  const missing = clientOf(new FakeSftpgo(), {
    request: async (url) =>
      url.includes('/token')
        ? { status: 200, headers: {}, body: JSON.stringify(await fixture('token.json')) }
        : { status: 501, headers: {}, body },
  });
  assert.deepEqual(await missing.events('uploads'), { state: EVENT_LOG.MISSING, events: [] });
  const fake = new FakeSftpgo();
  fake.permissions.delete('view_events');
  assert.equal((await clientOf(fake).events('logins')).state, EVENT_LOG.FORBIDDEN);
});

test('the event log: from a cursor, oldest first, the ids already seen skipped, paginated', async () => {
  let time = Date.UTC(2026, 9, 22, 8);
  const fake = new FakeSftpgo({ now: () => time });
  const first = fake.upload('scanner', '/a.pdf');
  fake.upload('scanner', '/b.pdf', { status: 2 }); // failed upload: not asked
  for (let i = 0; i < PAGE_SIZE + 10; i += 1) {
    time += 1;
    fake.upload('phone', `/p${i}.jpg`);
  }
  const client = clientOf(fake);
  const { state, events, truncated } = await client.events('uploads', {
    sinceMs: Math.floor(first.timestamp / 1e6),
    seen: new Set([first.id]),
  });
  assert.equal(state, EVENT_LOG.OK);
  assert.equal(truncated, undefined);
  assert.equal(events.length, PAGE_SIZE + 10);
  assert.equal(events[0].path, '/p0.jpg');
  assert.equal(events.at(-1).path, `/p${PAGE_SIZE + 9}.jpg`);
  // The first read: one page of the newest, oldest first.
  const newest = await client.events('uploads', { newest: true });
  assert.equal(newest.events.length, PAGE_SIZE);
  assert.equal(newest.events.at(-1).path, `/p${PAGE_SIZE + 9}.jpg`);
});

test('the address: bare host, port 8080, interface pages dropped, credentials refused', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:8080');
  assert.equal(parseServerUrl('nas.local:9000'), 'http://nas.local:9000');
  assert.equal(parseServerUrl('http://192.0.2.10:8080/web/admin/users'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl('https://files.example.org/sftpgo/api/v2/'),
    'https://files.example.org/sftpgo',
  );
  assert.equal(parseServerUrl('https://files.example.org'), 'https://files.example.org');
  assert.equal(parseServerUrl('http://admin:pw@192.0.2.10:8080'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl(''), null);
  const config = normalizeConfig({ url: ' 192.0.2.10 ', poll_interval: '7', password: ' p ' });
  assert.equal(config.url, 'http://192.0.2.10:8080');
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.password, ' p ');
  assert.equal(config.quotaThreshold, 90);
  assert.equal(config.language, 'fr');
});
