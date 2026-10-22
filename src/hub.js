// -----------------------------------------------------------------------------
// The SFTPGo hub: the server read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published when
// they change, the scene events fired on the uploads, the failed logins and the
// quotas crossing the threshold, and the views the widget and the scene action
// read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every user, added to Gladys or not.
//
// The uploads and the failed logins come from the event log of SFTPGo
// (/events/fs, /events/logs: its eventstore and eventsearch plugins). The
// integration reads it from a cursor kept in /data (src/store.js), so a file
// uploaded while the integration or Gladys restarted is still announced, once.
// The first read only records: nothing that happened before is announced.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildServerDevice,
  buildUserDevice,
  parseUserId,
  quotaPercent,
  serverIds,
  serverValues,
  userId,
  userIds,
  userValues,
} from './devices.js';
import { ERROR_KINDS, EVENT_LOG, SftpgoClient, SftpgoError } from './sftpgo/client.js';
import { hasCredentials, hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatBytes,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'sftpgo-hub' });

export const WIDGET_KEY = 'recent_uploads';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  FILE_UPLOADED: 'file_uploaded',
  QUOTA_THRESHOLD: 'quota_threshold_reached',
  LOGIN_FAILED: 'login_failed',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads SFTPGo again when the last read is older.
  freshMs: 15_000,
  // A missing event log (no plugin, no permission) is asked again this often.
  eventLogRetryMs: 3600_000,
};

// Scene events per reading cycle: a folder of 500 photos does not start 500 scenes.
export const MAX_UPLOAD_EVENTS = 20;
export const MAX_LOGIN_EVENTS = 10;
// The uploads kept for the widget.
export const RECENT_UPLOADS = 20;
// A quota event fires again once the usage went this many points below the threshold.
export const QUOTA_HYSTERESIS = 5;

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** Local midnight (the time zone of Gladys, injected as TZ) and its day key. */
export function dayOf(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    start: date.getTime(),
    key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
  };
}

const emptyToday = (key) => ({ key, uploads: 0, failedLogins: 0, byUser: {} });

/** Cursor of an event list after `events` (oldest first): last millisecond, ids seen in it. */
function advance(cursor, events) {
  if (events.length === 0) {
    return cursor;
  }
  const ms = events.at(-1).time;
  const ids = events.filter((event) => event.time === ms).map((event) => event.id);
  if (cursor && cursor.ms === ms) {
    ids.unshift(...cursor.ids);
  }
  return { ms, ids: [...new Set(ids)].slice(-1000) };
}

export class SftpgoHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/sftpgo/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    this.resetView();
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.widgetKey = null;
    this.saved = this.emptySaved(null);
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  resetView() {
    /** @type {Map<string, object>} users of the last read, by username */
    this.users = new Map();
    this.connections = [];
    this.version = null;
    this.eventLog = null; // EVENT_LOG state, null before the first read
    this.eventLogAt = 0;
    this.readAt = 0;
    this.error = null;
  }

  emptySaved(url) {
    return {
      url,
      uploads: null,
      logins: null,
      today: emptyToday(dayOf(this.now()).key),
      last: {},
      recent: [],
      quotaAbove: {},
    };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const base = this.emptySaved(typeof saved?.url === 'string' ? saved.url : null);
    const object = (value) => (value && typeof value === 'object' ? value : null);
    this.saved = {
      ...base,
      uploads: object(saved?.uploads),
      logins: object(saved?.logins),
      today: object(saved?.today) ?? base.today,
      last: object(saved?.last) ?? {},
      recent: Array.isArray(saved?.recent) ? saved.recent : [],
      quotaAbove: object(saved?.quotaAbove) ?? {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiKey, config.username, config.password]);
    if (signature !== this.signature) {
      if (config.url && this.saved.url !== config.url) {
        // Another server: what was seen of the previous one means nothing here.
        this.saved = this.emptySaved(config.url);
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client =
        config.url && hasCredentials(config)
          ? new SftpgoClient({
              url: config.url,
              apiKey: config.apiKey,
              username: config.username,
              password: config.password,
              request: this.request,
              now: this.now,
            })
          : null;
      this.resetView();
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges({ publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading SFTPGo works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading SFTPGo -----------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    await this.poll();
    await this.afterChanges({ publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /** Read the server and apply what changed. Concurrent calls share the read. */
  poll() {
    if (!this.client) {
      return Promise.resolve();
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let snapshot;
    try {
      snapshot = await this.fetch(client);
    } catch (err) {
      if (!(err instanceof SftpgoError)) {
        throw err;
      }
      if (client === this.client) {
        this.applyFailure(err);
        await this.publishStates(); // "Online" goes to 0
      }
      return;
    }
    if (client === this.client) {
      await this.applySuccess(snapshot);
    }
  }

  /** Everything SFTPGo says. The event log is asked again later when it is missing. */
  async fetch(client) {
    const version = this.version ?? (await client.version());
    const users = await client.users();
    const connections = await client.connections();
    const now = this.now();
    const skipLog =
      (this.eventLog === EVENT_LOG.MISSING || this.eventLog === EVENT_LOG.FORBIDDEN) &&
      now - this.eventLogAt < this.timings.eventLogRetryMs;
    let eventLog = skipLog ? this.eventLog : EVENT_LOG.OK;
    let uploads = null;
    let logins = null;
    if (!skipLog) {
      try {
        uploads = await this.readEvents(client, 'uploads');
        eventLog = uploads.state;
        if (eventLog === EVENT_LOG.OK) {
          logins = await this.readEvents(client, 'logins');
          eventLog = logins.state;
        }
        this.problems.recover('events', 'The event log of SFTPGo answers again');
      } catch (err) {
        // The users and connections answered: only the log is down.
        if (!(err instanceof SftpgoError) || err.kind === ERROR_KINDS.UNREACHABLE) {
          throw err;
        }
        this.problems.fail('events', `Event log unreadable: ${err.message}`);
        eventLog = EVENT_LOG.ERROR;
        uploads = null;
        logins = null;
      }
    }
    return { version, users, connections, eventLog, uploads, logins, checked: !skipLog };
  }

  async readEvents(client, kind) {
    const cursor = this.saved[kind];
    if (!cursor) {
      const result = await client.events(kind, { newest: true });
      return { ...result, initial: true };
    }
    const result = await client.events(kind, {
      sinceMs: cursor.ms,
      seen: new Set(cursor.ids),
    });
    return { ...result, initial: false };
  }

  async applySuccess({ version, users, connections, eventLog, uploads, logins, checked }) {
    if (this.error) {
      logger.info('SFTPGo answers again');
    }
    if (this.readAt === 0) {
      logger.info(
        `SFTPGo ${version} (${hostOf(this.config.url)}): ${users.length} user(s), event log ${eventLog}`,
      );
    } else if (eventLog !== this.eventLog) {
      logger.info(`Event log of SFTPGo: ${eventLog}`);
    }
    const now = this.now();
    this.error = null;
    this.readAt = now;
    this.version = version;
    if (checked) {
      this.eventLogAt = now;
    }
    this.eventLog = eventLog;
    this.users = new Map(users.map((user) => [user.username, user]));
    this.connections = connections;

    let dirty = this.rollDay();
    if (uploads?.state === EVENT_LOG.OK) {
      dirty = (await this.applyUploads(uploads)) || dirty;
    }
    if (logins?.state === EVENT_LOG.OK) {
      dirty = (await this.applyLogins(logins)) || dirty;
    }
    dirty = (await this.applyQuotas()) || dirty;
    // A user deleted in SFTPGo is forgotten.
    for (const table of [this.saved.last, this.saved.quotaAbove, this.saved.today.byUser]) {
      for (const username of Object.keys(table)) {
        if (!this.users.has(username)) {
          delete table[username];
          dirty = true;
        }
      }
    }
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.saved.url = this.config.url;
      this.store.save(this.saved);
    }
    await this.publishStates();
  }

  applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`SFTPGo: ${err.message}`);
    }
  }

  /** A new day: the daily counts start again. */
  rollDay() {
    const { key } = dayOf(this.now());
    if (this.saved.today?.key === key) {
      return false;
    }
    this.saved.today = emptyToday(key);
    return true;
  }

  /** The new uploads: counted, remembered, announced (not on the first read). */
  async applyUploads({ events, initial, truncated }) {
    if (events.length === 0) {
      return false;
    }
    const today = dayOf(this.now());
    const announced = [];
    for (const upload of events) {
      if (upload.time >= today.start) {
        this.saved.today.uploads += 1;
        this.saved.today.byUser[upload.username] =
          (this.saved.today.byUser[upload.username] ?? 0) + 1;
      }
      const last = this.saved.last[upload.username];
      if (!last || upload.time >= last.time) {
        this.saved.last[upload.username] = {
          path: upload.path,
          time: upload.time,
          size: upload.size,
        };
      }
      this.saved.recent.unshift({
        username: upload.username,
        path: upload.path,
        fileName: upload.fileName,
        size: upload.size,
        time: upload.time,
      });
      if (!initial) {
        announced.push(upload);
      }
    }
    this.saved.recent = this.saved.recent.sort((a, b) => b.time - a.time).slice(0, RECENT_UPLOADS);
    this.saved.uploads = advance(this.saved.uploads, events);
    for (const upload of announced.slice(0, MAX_UPLOAD_EVENTS)) {
      logger.debug(`${upload.username} uploaded ${upload.path}`);
      await this.fire(TRIGGERS.FILE_UPLOADED, {
        device: userIds(this.gladys, upload.username).device,
        user: upload.username,
        path: upload.path,
        folder: upload.folder,
        file_name: upload.fileName,
        extension: upload.extension,
        size: formatBytes(upload.size),
        size_bytes: upload.size,
        protocol: upload.protocol,
        ip: upload.ip,
      });
    }
    if (announced.length > MAX_UPLOAD_EVENTS || truncated) {
      logger.info(
        `${announced.length} upload(s) since the last read: the first ${MAX_UPLOAD_EVENTS} announced`,
      );
    }
    return true;
  }

  /** The new failed logins: counted, announced by user and address (not on the first read). */
  async applyLogins({ events, initial }) {
    if (events.length === 0) {
      return false;
    }
    const today = dayOf(this.now());
    const groups = new Map();
    for (const failure of events) {
      if (failure.time >= today.start) {
        this.saved.today.failedLogins += 1;
      }
      const key = `${failure.username}\n${failure.ip}`;
      const group = groups.get(key) ?? { ...failure, attempts: 0 };
      group.attempts += 1;
      group.message = failure.message || group.message;
      groups.set(key, group);
    }
    this.saved.logins = advance(this.saved.logins, events);
    if (!initial) {
      for (const failure of [...groups.values()].slice(0, MAX_LOGIN_EVENTS)) {
        logger.debug(`Failed login of "${failure.username}" from ${failure.ip}`);
        await this.fire(TRIGGERS.LOGIN_FAILED, {
          user: failure.username,
          ip: failure.ip,
          protocol: failure.protocol,
          attempts: failure.attempts,
          reason: failure.message,
          unknown_user: failure.unknownUser,
        });
      }
    }
    return true;
  }

  /** Users crossing the quota threshold; the first sight of a user only records. */
  async applyQuotas() {
    let dirty = false;
    const threshold = this.config.quotaThreshold;
    for (const user of this.users.values()) {
      const percent = quotaPercent(user);
      const before = this.saved.quotaAbove[user.username];
      if (percent === null) {
        if (before !== undefined) {
          delete this.saved.quotaAbove[user.username];
          dirty = true;
        }
        continue;
      }
      let above = before ?? percent >= threshold;
      if (before === undefined) {
        dirty = true;
      } else if (!before && percent >= threshold) {
        above = true;
        logger.info(`${user.username}: quota ${percent} % used`);
        await this.fire(TRIGGERS.QUOTA_THRESHOLD, {
          device: userIds(this.gladys, user.username).device,
          user: user.username,
          percent,
          threshold,
          used_size: formatBytes(user.usedSize),
          quota_size: user.quotaSize > 0 ? formatBytes(user.quotaSize) : '',
        });
      } else if (before && percent < threshold - QUOTA_HYSTERESIS) {
        above = false;
      }
      if (above !== before) {
        this.saved.quotaAbove[user.username] = above;
        dirty = true;
      }
    }
    return dirty;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  get eventLogOk() {
    return this.eventLog === EVENT_LOG.OK;
  }

  discoveredDevices() {
    const language = this.config.language;
    if (!this.client || this.readAt === 0 || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    return [
      buildServerDevice(this.gladys, language, this.version ?? ''),
      ...[...this.users.values()].map((user) => buildUserDevice(this.gladys, user, language)),
    ];
  }

  /** Publish the Discovery list when it changed (a user added…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read SFTPGo, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges({ publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0) {
      return;
    }
    const states = [];
    const push = (values) => {
      for (const { key: _key, ...state } of values) {
        states.push(state);
      }
    };
    if (this.isCreated(serverIds(this.gladys).device)) {
      push(
        serverValues(this.gladys, {
          online: !this.error,
          eventLog: this.eventLogOk,
          connections: this.connections,
          users: [...this.users.values()],
          today: this.saved.today,
        }),
      );
    }
    if (!this.error) {
      for (const user of this.users.values()) {
        if (this.isCreated(userIds(this.gladys, user.username).device)) {
          push(userValues(this.gladys, user, this.userContext(user.username)));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  userContext(username) {
    return {
      connections: this.connections,
      eventLog: this.eventLogOk,
      uploadsToday: this.saved.today.byUser[username] ?? 0,
      last: this.saved.last[username] ?? null,
      language: this.config.language,
    };
  }

  async afterChanges({ publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    // The widget reloads when what it shows changed.
    const widgetKey = JSON.stringify([
      this.error?.kind,
      this.eventLog,
      this.connections.length,
      this.saved.today.uploads,
      this.saved.today.failedLogins,
      this.saved.recent[0]?.time,
    ]);
    if (widgetKey !== this.widgetKey) {
      this.widgetKey = widgetKey;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const entries = [
      serverIds(this.gladys).device,
      ...[...this.users.keys()].map((username) => userIds(this.gladys, username).device),
    ]
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!hasCredentials(this.config)) {
      return { connected: false, message: CONNECTION_TEXT.noCredentials };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene action, report) ------------------------------------------

  /** The user of a device external id, null when it is not one (or no longer exists). */
  find(externalId) {
    const id = parseUserId(this.gladys, externalId);
    if (!id) {
      return null;
    }
    return [...this.users.values()].find((user) => userId(user.username) === id) ?? null;
  }

  /** Throws the reason SFTPGo cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** The user of a device, read again if stale; throws a readable error. */
  async userOf(externalId) {
    // Only the configuration first: a past error is what the read below clears.
    if (!this.client) {
      this.assertReadable();
    }
    await this.refreshIfStale();
    this.assertReadable();
    const user = this.find(externalId);
    if (!user) {
      throw new Error(pick(ACTION_TEXT.unknownUser, this.config.language));
    }
    return user;
  }

  /** "Test the connection": read SFTPGo now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = labelled('SFTPGo', pick(status.message, language), language);
        continue;
      }
      const parts = [
        text.ok(this.version),
        text.users(this.users.size),
        text.connections(this.connections.length),
        this.eventLogOk ? text.eventLog : text.noEventLog,
      ];
      message[language] = labelled('SFTPGo', parts.join(', '), language);
    }
    logger.info('Connection tested from Gladys');
    return message;
  }
}
