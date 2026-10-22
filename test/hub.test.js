// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake SFTPGo: discovery, states,
// scene events on uploads, quotas and failed logins, persistence across
// restarts, the day change, a server without event log, errors, the scene
// action, the widget, quiet logs and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { SERVER_KEYS, USER_KEYS } from '../src/devices.js';
import { MAX_UPLOAD_EVENTS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  ADMIN,
  API_KEY,
  BASE,
  FakeSftpgo,
  HOUR,
  MINUTE,
  PASSWORD,
  createClock,
  createDevices,
  createWorld,
  defaultSftpgo,
  idsOf,
  serverIdsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const user = (world, name, key) => world.fake.lastState(idsOf(world, name).feature(key));
const server = (world, key) => world.fake.lastState(serverIdsOf(world).feature(key));
const config = (extra = {}) => ({
  url: BASE,
  username: ADMIN,
  password: PASSWORD,
  language: 'en',
  ...extra,
});

test('one device for the server and one per user, proposed in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['SFTPGo', 'SFTPGo scanner', 'SFTPGo phone'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  assert.deepEqual(devices[0].params, [{ name: 'VERSION', value: '2.7.6' }]);
  // Nothing is published for devices not added, and the first read fires nothing.
  assert.equal(world.fake.states.length, 0);
  assert.equal(world.fake.sceneEvents.length, 0);
  assert.equal(world.fake.connectionStatus.connected, true);
});

test('the states of the added devices, the history of the event log counted', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(server(world, SERVER_KEYS.ONLINE), 1);
  assert.equal(server(world, SERVER_KEYS.EVENT_LOG), 1);
  assert.equal(server(world, SERVER_KEYS.CONNECTIONS), 1);
  assert.equal(server(world, SERVER_KEYS.TRANSFERS), 0);
  assert.equal(server(world, SERVER_KEYS.USERS), 2);
  // The photo of yesterday does not count.
  assert.equal(server(world, SERVER_KEYS.UPLOADS_TODAY), 2);
  assert.equal(server(world, SERVER_KEYS.FAILED_LOGINS_TODAY), 1);

  assert.equal(user(world, 'scanner', USER_KEYS.QUOTA_USED), 50);
  assert.equal(user(world, 'scanner', USER_KEYS.QUOTA_FILES_USED), 0);
  assert.equal(user(world, 'scanner', USER_KEYS.USED_SIZE), 5);
  assert.equal(user(world, 'scanner', USER_KEYS.FILES), 2);
  assert.equal(user(world, 'scanner', USER_KEYS.CONNECTIONS), 0);
  assert.equal(user(world, 'scanner', USER_KEYS.UPLOADS_TODAY), 2);
  assert.equal(user(world, 'scanner', USER_KEYS.LAST_UPLOAD), '/scans/scan-002.pdf');
  assert.equal(user(world, 'scanner', USER_KEYS.LAST_UPLOAD_TIME), '22/10, 09:00');

  assert.equal(user(world, 'phone', USER_KEYS.QUOTA_USED), 0);
  // Not tracked by SFTPGo without quota: unknown, not zero.
  assert.equal(user(world, 'phone', USER_KEYS.USED_SIZE), undefined);
  assert.equal(user(world, 'phone', USER_KEYS.CONNECTIONS), 1);
  assert.equal(user(world, 'phone', USER_KEYS.UPLOADS_TODAY), 0);
  assert.equal(user(world, 'phone', USER_KEYS.LAST_UPLOAD), '/DCIM/photo.jpg');
  assert.ok(world.fake.transports.every((entry) => entry.transport === 'local'));
});

test('a file uploaded fires "file_uploaded" once, with its details', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.clock.advance(MINUTE);
  world.sftpgo.upload('scanner', '/scans/Invoice 2026.PDF', { size: 1_234_567 });
  await world.hub.pollNow();
  await world.hub.pollNow();
  const fired = events(world, TRIGGERS.FILE_UPLOADED);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    device: idsOf(world, 'scanner').device,
    user: 'scanner',
    path: '/scans/Invoice 2026.PDF',
    folder: '/scans',
    file_name: 'Invoice 2026.PDF',
    extension: 'pdf',
    size: '1.2 MB',
    size_bytes: 1_234_567,
    protocol: 'SFTP',
    ip: '198.51.100.7',
  });
  assert.equal(server(world, SERVER_KEYS.UPLOADS_TODAY), 3);
  assert.equal(user(world, 'scanner', USER_KEYS.LAST_UPLOAD), '/scans/Invoice 2026.PDF');
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('two uploads in the same millisecond are both announced, a burst is capped', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(MINUTE);
  world.sftpgo.upload('phone', '/a.jpg');
  await world.hub.pollNow();
  world.sftpgo.upload('phone', '/b.jpg');
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.FILE_UPLOADED).map((e) => e.data.path),
    ['/a.jpg', '/b.jpg'],
  );
  for (let i = 0; i < 50; i += 1) {
    world.clock.advance(1);
    world.sftpgo.upload('phone', `/burst/${i}.jpg`);
  }
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FILE_UPLOADED).length, 2 + MAX_UPLOAD_EVENTS);
  // Counted all the same.
  assert.equal(world.hub.saved.today.uploads, 2 + 2 + 50);
});

test('a file uploaded while the integration was stopped is announced once after the restart', async (t) => {
  const clock = createClock();
  const sftpgo = defaultSftpgo(clock);
  const first = await createWorld({ clock, sftpgo });
  await first.app.stop();
  clock.advance(10 * MINUTE);
  sftpgo.upload('scanner', '/scans/while-away.pdf');
  const second = await createWorld({ clock, sftpgo, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    events(second, TRIGGERS.FILE_UPLOADED).map((e) => e.data.path),
    ['/scans/while-away.pdf'],
  );
  assert.equal(second.hub.saved.today.uploads, 3);
  await second.app.stop();
  const third = await createWorld({ clock, sftpgo, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, TRIGGERS.FILE_UPLOADED).length, 0);
});

test('the daily counts start again at midnight', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.clock.advance(14 * HOUR); // 00:00 on the 23rd in Paris
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.UPLOADS_TODAY), 0);
  assert.equal(server(world, SERVER_KEYS.FAILED_LOGINS_TODAY), 0);
  assert.equal(user(world, 'scanner', USER_KEYS.UPLOADS_TODAY), 0);
  // The last upload stays.
  assert.equal(user(world, 'scanner', USER_KEYS.LAST_UPLOAD), '/scans/scan-002.pdf');
});

test('a quota crossing the threshold fires once, again only after going back down', async (t) => {
  const world = await createWorld({ config: config({ quota_threshold: '80' }) });
  t.after(() => world.app.stop());
  const usage = async (usedSize) => {
    world.sftpgo.setUsage('scanner', { usedSize, usedFiles: 3 });
    await world.hub.pollNow();
  };
  await usage(8_200_000);
  await usage(8_500_000);
  await usage(7_800_000); // within the hysteresis: still above
  await usage(8_100_000);
  const fired = events(world, TRIGGERS.QUOTA_THRESHOLD);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    device: idsOf(world, 'scanner').device,
    user: 'scanner',
    percent: 82,
    threshold: 80,
    used_size: '8.2 MB',
    quota_size: '10.0 MB',
  });
  await usage(6_000_000);
  await usage(9_000_000);
  assert.equal(events(world, TRIGGERS.QUOTA_THRESHOLD).length, 2);
});

test('a user already above the threshold at the first read is not announced', async (t) => {
  const clock = createClock();
  const sftpgo = defaultSftpgo(clock);
  sftpgo.setUsage('scanner', { usedSize: 9_900_000, usedFiles: 1 });
  const world = await createWorld({ clock, sftpgo });
  t.after(() => world.app.stop());
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.QUOTA_THRESHOLD).length, 0);
});

test('failed logins fire "login_failed", one event per user and address', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(MINUTE);
  for (let i = 0; i < 4; i += 1) {
    world.sftpgo.failLogin('admin', { ip: '203.0.113.50', event: 2 });
  }
  world.sftpgo.failLogin('phone', { protocol: 'DAV' });
  await world.hub.pollNow();
  const fired = events(world, TRIGGERS.LOGIN_FAILED).map((e) => e.data);
  assert.deepEqual(fired, [
    {
      user: 'admin',
      ip: '203.0.113.50',
      protocol: 'SSH',
      attempts: 4,
      reason: 'invalid credentials',
      unknown_user: true,
    },
    {
      user: 'phone',
      ip: '203.0.113.9',
      protocol: 'DAV',
      attempts: 1,
      reason: 'invalid credentials',
      unknown_user: false,
    },
  ]);
  assert.equal(world.hub.saved.today.failedLogins, 6);
});

test('without the event log plugin: the rest works, the uploads are not followed, asked again hourly', async (t) => {
  const clock = createClock();
  const sftpgo = defaultSftpgo(clock);
  sftpgo.plugin = false;
  const world = await createWorld({ clock, sftpgo });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(server(world, SERVER_KEYS.EVENT_LOG), 0);
  assert.equal(server(world, SERVER_KEYS.UPLOADS_TODAY), undefined);
  assert.equal(user(world, 'scanner', USER_KEYS.LAST_UPLOAD), undefined);
  assert.equal(user(world, 'scanner', USER_KEYS.QUOTA_USED), 50);
  const report = await world.fake.action('test_connection', {});
  assert.match(report.data.message.en, /uploads not followed/);
  const asked = () => sftpgo.calls.filter((c) => c.startsWith('/api/v2/events/fs')).length;
  const before = asked();
  clock.advance(30 * MINUTE);
  await world.hub.pollNow();
  assert.equal(asked(), before);
  // The plugins installed: the next check finds the log, and records without announcing.
  sftpgo.plugin = true;
  clock.advance(31 * MINUTE);
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.EVENT_LOG), 1);
  assert.equal(events(world, TRIGGERS.FILE_UPLOADED).length, 0);
  sftpgo.upload('phone', '/new.jpg');
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.FILE_UPLOADED).length, 1);
});

test('SFTPGo down: offline, unreachable badge, readable status; back: everything again', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.sftpgo.down = true;
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.ONLINE), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(world.fake.connectionStatus.message.en, 'SFTPGo does not answer');
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.sftpgo.down = false;
  world.clock.advance(MINUTE);
  world.sftpgo.upload('scanner', '/scans/after.pdf');
  await world.hub.pollNow();
  assert.equal(server(world, SERVER_KEYS.ONLINE), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
  assert.equal(events(world, TRIGGERS.FILE_UPLOADED).length, 1);
});

test('configuration missing or refused: a status that says what to do', async (t) => {
  const empty = await createWorld({ config: { language: 'en' } });
  t.after(() => empty.app.stop());
  assert.match(empty.fake.connectionStatus.message.en, /address of your SFTPGo server/);
  const noCredentials = await createWorld({ config: { url: BASE } });
  t.after(() => noCredentials.app.stop());
  assert.match(noCredentials.fake.connectionStatus.message.en, /API key/);
  const wrong = await createWorld({ config: config({ password: 'nope' }) });
  t.after(() => wrong.app.stop());
  assert.match(wrong.fake.connectionStatus.message.en, /refused by SFTPGo/);
  const key = await createWorld({ config: { url: BASE, api_key: API_KEY } });
  t.after(() => key.app.stop());
  assert.equal(key.fake.connectionStatus.connected, true);
});

test('another server forgets what was seen of the previous one', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const other = new FakeSftpgo({ now: world.clock.now });
  other.addUser('alice');
  world.hub.request = other.request;
  await world.fake.configUpdated(config({ url: 'http://198.51.100.20:8080' }));
  assert.deepEqual(world.hub.saved.last, {});
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    ['SFTPGo', 'SFTPGo alice'],
  );
});

test('the scene action reads the state of a user, with a ready-made sentence', async (t) => {
  const world = await createWorld({ config: config({ language: 'fr' }) });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_user_status', {
    device: idsOf(world, 'scanner').device,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    user: 'scanner',
    quota_percent: 50,
    used_size: '5.0 MB',
    files: 2,
    connections: 0,
    uploads_today: 2,
    last_upload: '/scans/scan-002.pdf',
    last_upload_time: '22/10 09:00',
    sentence: 'scanner : quota utilisé à 50 %, dernier fichier /scans/scan-002.pdf le 22/10 09:00.',
  });
  const phone = await world.fake.sceneAction('get_user_status', {
    device: idsOf(world, 'phone').device,
  });
  assert.equal(phone.data.outputs.quota_percent, -1);
  assert.equal(phone.data.outputs.files, -1);
  const unknown = await world.fake.sceneAction('get_user_status', { device: 'nope' });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /pas un utilisateur SFTPGo/);
});

test('the widget: valid in every state, filtered by user, refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const content = async (settings = {}, language = 'en') => {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language });
    assert.equal(ack.success, true, ack.error);
    // Every violation the core would log or trim, warnings included.
    assert.deepEqual(validateWidgetContent(ack.data.content), []);
    return ack.data.content;
  };
  const all = await content();
  const rows = all.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    rows.map((r) => [r.label, r.value]),
    [
      ['scan-002.pdf', 'scanner · 22/10, 09:00'],
      ['scan-001.pdf', 'scanner · 22/10, 08:00'],
      ['photo.jpg', 'phone · 21/10, 14:00'],
    ],
  );
  assert.deepEqual(
    all.components.filter((c) => c.type === 'value').map((c) => c.value),
    [2, 1, 1],
  );
  const phone = await content({ users: [idsOf(world, 'phone').device] }, 'de');
  assert.equal(phone.components.find((c) => c.type === 'status').items.length, 1);
  assert.equal(phone.components[0].value, 0);
  world.sftpgo.down = true;
  await world.hub.pollNow();
  const down = await content({}, 'es');
  assert.ok(down.components.some((c) => c.type === 'text' && /SFTPGo no responde/.test(c.text)));
  world.sftpgo.down = false;
  const action = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { language: 'en' });
  assert.equal(action.success, true, action.error);
  world.sftpgo.plugin = false;
  world.hub.eventLog = null;
  await world.hub.pollNow();
  const noLog = await content({}, 'fr');
  assert.ok(noLog.components.some((c) => c.type === 'text' && /plugins eventstore/.test(c.text)));
  const unset = await createWorld({ config: { language: 'en' } });
  t.after(() => unset.app.stop());
  const ack = await unset.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(ack.data.content.components[0].type, 'text');
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle, uploads included, writes nothing at the info level, nor a secret', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      world.clock.advance(30_000);
      world.sftpgo.upload('phone', `/cycle-${cycle}.jpg`);
      await world.hub.pollNow();
    }
  });
  assert.equal(events(world, TRIGGERS.FILE_UPLOADED).length, 6);
  assert.ok(!lines.join('\n').includes(PASSWORD));
  assert.deepEqual(lines, []);
});

test('the internal timer reads SFTPGo at the interval of the configuration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true, config: config({ poll_interval: '10' }) });
  t.after(() => world.app.stop());
  const reads = () => world.sftpgo.calls.filter((c) => c.startsWith('/api/v2/connections')).length;
  const before = reads();
  t.mock.timers.tick(10_000);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(reads(), before + 1);
});
