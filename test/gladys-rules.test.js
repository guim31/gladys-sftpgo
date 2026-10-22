// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from the real
// answers of SFTPGo 2.7.6 (test/fixtures/sftpgo: a user with a quota, one
// without, a connection uploading, the event log), in every feature-name
// language, with and without the event log.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';

process.env.LOG_LEVEL ??= 'silent';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const fixture = (name) => readFile(new URL(`./fixtures/sftpgo/${name}`, import.meta.url), 'utf8');

/** A request seam answering with the real fixtures. */
async function realServer(plugin) {
  const files = {
    '/token': await fixture('token.json'),
    '/version': await fixture('version.json'),
    '/users': await fixture('users.json'),
    '/connections': await fixture('connections.json'),
    '/events/fs': await fixture('events-fs.json'),
    '/events/logs': await fixture('events-logs.json'),
  };
  return async (url) => {
    const path = new URL(url).pathname.replace('/api/v2', '');
    if (path.startsWith('/events/') && !plugin) {
      return { status: 501, headers: {}, body: await fixture('no-plugin.json') };
    }
    return path in files
      ? { status: 200, headers: {}, body: files[path] }
      : { status: 404, headers: {}, body: '' };
  };
}

async function discover(language, plugin) {
  const gladys = createFakeGladys({
    config: { url: 'http://192.0.2.10:8080', username: 'gladys', password: 'x', language },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-sftpgo-rules-'))),
    timers: false,
    request: await realServer(plugin),
  });
  await gladys.connect();
  await app.ready;
  // Every device added: its states must be accepted too.
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await app.stop();
  return { devices: gladys.fake.discoveredDevices, states: gladys.fake.states };
}

const scenarios = [
  { label: 'event log, English names', language: 'en', plugin: true },
  { label: 'no event log, French names', language: 'fr', plugin: false },
  { label: 'event log, German names', language: 'de', plugin: true },
  { label: 'no event log, Spanish names', language: 'es', plugin: false },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { devices, states } = await discover(scenario.language, scenario.plugin);
    assert.equal(devices.length, 3, 'the server and the two users');
    assert.equal(
      new Set(devices.map((device) => device.external_id)).size,
      devices.length,
      'unique device external ids',
    );

    for (const device of devices) {
      const where = device.name;

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      const couples = new Map();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const couple = `${feature.category}/${feature.type}`;
        const pair = table.pairs[couple];
        assert.ok(pair, `${at}: ${couple} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );
        couples.set(couple, (couples.get(couple) ?? 0) + 1);

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
        }

        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
      // A feature alone of its couple shows the generic label of the couple on
      // the dashboard: only the size ("Size") may be alone.
      for (const [couple, count] of couples) {
        assert.ok(count > 1 || couple === 'data/size', `${where}: ${couple} alone on the device`);
      }
    }

    // Every state lands on a declared feature, within its bounds.
    const features = new Map(
      devices.flatMap((device) => device.features).map((f) => [f.external_id, f]),
    );
    assert.ok(states.length > 0);
    for (const state of states) {
      const feature = features.get(state.device_feature_external_id);
      assert.ok(feature, `${state.device_feature_external_id}: unknown feature`);
      if (feature.type === 'text') {
        assert.ok(typeof state.text === 'string' && state.text.length > 0, `${feature.name}: text`);
      } else {
        assert.ok(
          state.state >= feature.min && state.state <= feature.max,
          `${feature.name}: ${state.state} out of [${feature.min}, ${feature.max}]`,
        );
      }
    }
  });
}
