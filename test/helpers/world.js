// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake SFTPGo, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read SFTPGo with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-kopia.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { serverIds, userIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ADMIN, API_KEY, BASE, FakeSftpgo, PASSWORD } from './fakeSftpgo.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';
// The daily counts start at local midnight: the tests run in a fixed zone.
process.env.TZ = 'Europe/Paris';

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
// 22/10/2026 10:00 in Paris.
export const START = Date.UTC(2026, 9, 22, 8, 0, 0);

/** A manual clock, shared by the hub, the fake and the tests. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * The default server: "scanner" with a 10 MB quota half used, two scans
 * uploaded this morning; "phone" without quota, a photo uploaded yesterday
 * and connected now; one failed login this morning.
 */
export function defaultSftpgo(clock) {
  const fake = new FakeSftpgo({ now: clock.now });
  fake.addUser('scanner', { quotaSize: 10_000_000, usedSize: 5_000_000, usedFiles: 2 });
  fake.addUser('phone');
  fake.upload('phone', '/DCIM/photo.jpg', { protocol: 'DAV', time: clock.time - 20 * HOUR });
  fake.upload('scanner', '/scans/scan-001.pdf', { time: clock.time - 2 * HOUR });
  fake.upload('scanner', '/scans/scan-002.pdf', { time: clock.time - HOUR });
  fake.failLogin('scanner', { time: clock.time - 30 * MINUTE });
  fake.connect('phone', { protocol: 'DAV' });
  return fake;
}

export async function createWorld({
  clock = createClock(),
  sftpgo = defaultSftpgo(clock),
  config = { url: BASE, username: ADMIN, password: PASSWORD, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-sftpgo-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: sftpgo.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, sftpgo, app, hub: app.hub, clock, dataDir };
}

/** External ids of the device of a user. */
export const idsOf = (world, username) => userIds(world.gladys, username);
export const serverIdsOf = (world) => serverIds(world.gladys);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** The last state published on a feature. */
export function stateOf(world, featureId) {
  const states = world.fake.states.filter((s) => s.device_feature_external_id === featureId);
  const last = states.at(-1);
  return last ? (last.text ?? last.state) : undefined;
}

export { ADMIN, API_KEY, BASE, FakeSftpgo, PASSWORD };
