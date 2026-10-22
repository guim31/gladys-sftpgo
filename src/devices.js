// -----------------------------------------------------------------------------
// The Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one "SFTPGo" device for the server:
//       online               input/binary            1 while the API answers
//       event_log            input/binary            1 when the uploads are followed
//       connections          counter-sensor/integer  open connections
//       transfers            counter-sensor/integer  uploads and downloads running
//       users                counter-sensor/integer  users of the server
//       uploads_today        counter-sensor/integer  files uploaded since midnight
//       failed_logins_today  counter-sensor/integer  refused logins since midnight
//
//   - one device per user, identified by a hash of the username:
//       quota_used           level-sensor/liquid-level-percent  size quota used
//                            (0 without a size quota)
//       quota_files_used     level-sensor/liquid-level-percent  files quota used
//       used_size            data/size (MB)          when SFTPGo tracks the quota
//       files                counter-sensor/integer  files, same condition
//       connections          counter-sensor/integer  open connections of the user
//       uploads_today        counter-sensor/integer  files uploaded since midnight
//       last_upload          text/text               path of the last file uploaded
//       last_upload_time     text/text               its day/month hours:minutes
//
// The two quota percentages share their type on purpose: a feature alone of
// its type shows the generic label of the type on the dashboard ("Liquid level
// percent"). Published with should_poll: false: the integration reads SFTPGo
// on its own timer (src/hub.js).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { formatTime } from './texts.js';

export const USER_TYPE = 'user';
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const MODEL = 'SFTPGo';

// Suffixes of the feature external ids: permanent once published.
export const SERVER_KEYS = Object.freeze({
  ONLINE: 'online',
  EVENT_LOG: 'event_log',
  CONNECTIONS: 'connections',
  TRANSFERS: 'transfers',
  USERS: 'users',
  UPLOADS_TODAY: 'uploads_today',
  FAILED_LOGINS_TODAY: 'failed_logins_today',
});

export const USER_KEYS = Object.freeze({
  QUOTA_USED: 'quota_used',
  QUOTA_FILES_USED: 'quota_files_used',
  USED_SIZE: 'used_size',
  FILES: 'files',
  CONNECTIONS: 'connections',
  UPLOADS_TODAY: 'uploads_today',
  LAST_UPLOAD: 'last_upload',
  LAST_UPLOAD_TIME: 'last_upload_time',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
// Keys: `server_<key>` and `user_<key>`.
export const NAMES = {
  en: {
    server_online: 'Online',
    server_event_log: 'Uploads followed',
    server_connections: 'Connections',
    server_transfers: 'Transfers running',
    server_users: 'Users',
    server_uploads_today: 'Files uploaded today',
    server_failed_logins_today: 'Failed logins today',
    user_quota_used: 'Size quota used',
    user_quota_files_used: 'Files quota used',
    user_used_size: 'Space used',
    user_files: 'Files',
    user_connections: 'Connections',
    user_uploads_today: 'Files uploaded today',
    user_last_upload: 'Last file uploaded',
    user_last_upload_time: 'Last upload time',
  },
  fr: {
    server_online: 'En ligne',
    server_event_log: 'Dépôts suivis',
    server_connections: 'Connexions',
    server_transfers: 'Transferts en cours',
    server_users: 'Utilisateurs',
    server_uploads_today: "Fichiers déposés aujourd'hui",
    server_failed_logins_today: "Connexions refusées aujourd'hui",
    user_quota_used: 'Quota de taille utilisé',
    user_quota_files_used: 'Quota de fichiers utilisé',
    user_used_size: 'Espace utilisé',
    user_files: 'Fichiers',
    user_connections: 'Connexions',
    user_uploads_today: "Fichiers déposés aujourd'hui",
    user_last_upload: 'Dernier fichier déposé',
    user_last_upload_time: 'Heure du dernier dépôt',
  },
  de: {
    server_online: 'Online',
    server_event_log: 'Uploads verfolgt',
    server_connections: 'Verbindungen',
    server_transfers: 'Laufende Übertragungen',
    server_users: 'Benutzer',
    server_uploads_today: 'Heute hochgeladene Dateien',
    server_failed_logins_today: 'Heute abgelehnte Anmeldungen',
    user_quota_used: 'Belegtes Größenkontingent',
    user_quota_files_used: 'Belegtes Dateikontingent',
    user_used_size: 'Belegter Speicher',
    user_files: 'Dateien',
    user_connections: 'Verbindungen',
    user_uploads_today: 'Heute hochgeladene Dateien',
    user_last_upload: 'Zuletzt hochgeladene Datei',
    user_last_upload_time: 'Zeit des letzten Uploads',
  },
  es: {
    server_online: 'En línea',
    server_event_log: 'Subidas seguidas',
    server_connections: 'Conexiones',
    server_transfers: 'Transferencias en curso',
    server_users: 'Usuarios',
    server_uploads_today: 'Archivos subidos hoy',
    server_failed_logins_today: 'Inicios de sesión rechazados hoy',
    user_quota_used: 'Cuota de tamaño usada',
    user_quota_files_used: 'Cuota de archivos usada',
    user_used_size: 'Espacio usado',
    user_files: 'Archivos',
    user_connections: 'Conexiones',
    user_uploads_today: 'Archivos subidos hoy',
    user_last_upload: 'Último archivo subido',
    user_last_upload_time: 'Hora de la última subida',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_COUNT = 1_000_000_000;
export const MAX_SIZE_MB = 1_000_000_000;

/** The id of a user in Gladys: a hash of the username (external ids are forever). */
export const userId = (username) =>
  createHash('sha256').update(username).digest('hex').slice(0, 16);

export const userIds = (gladys, username) => gladys.externalIds(USER_TYPE, userId(username));
export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

/** The user id of a device external id, null when it is not a user of ours. */
export function parseUserId(gladys, externalId) {
  const prefix = gladys.externalIds(USER_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^[0-9a-f]{16}$/.test(id) ? id : null;
}

/** Percentage used of a quota, one decimal; null without the quota. */
export function percentOf(used, quota) {
  return quota > 0 ? Math.round((used / quota) * 1000) / 10 : null;
}

/** The highest of the two quota percentages, null when the user has none. */
export function quotaPercent(user) {
  const values = [
    percentOf(user.usedSize, user.quotaSize),
    percentOf(user.usedFiles, user.quotaFiles),
  ].filter((value) => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max: MAX_COUNT },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const percent = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
    DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: true, min: 0, max: 100 },
  );

const namesOf = (language) => NAMES[language] ?? NAMES.en;

/** The discovery payload of the server. */
export function buildServerDevice(gladys, language = 'en', version = '') {
  const ids = serverIds(gladys);
  const names = namesOf(language);
  const name = (key) => names[`server_${key}`];
  return {
    name: 'SFTPGo',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: version ? [{ name: 'VERSION', value: version.slice(0, 255) }] : [],
    features: [
      binary(name(SERVER_KEYS.ONLINE), ids.feature(SERVER_KEYS.ONLINE)),
      binary(name(SERVER_KEYS.EVENT_LOG), ids.feature(SERVER_KEYS.EVENT_LOG)),
      counter(name(SERVER_KEYS.CONNECTIONS), ids.feature(SERVER_KEYS.CONNECTIONS)),
      counter(name(SERVER_KEYS.TRANSFERS), ids.feature(SERVER_KEYS.TRANSFERS)),
      counter(name(SERVER_KEYS.USERS), ids.feature(SERVER_KEYS.USERS)),
      counter(name(SERVER_KEYS.UPLOADS_TODAY), ids.feature(SERVER_KEYS.UPLOADS_TODAY)),
      counter(name(SERVER_KEYS.FAILED_LOGINS_TODAY), ids.feature(SERVER_KEYS.FAILED_LOGINS_TODAY)),
    ],
  };
}

/** The discovery payload of a user. */
export function buildUserDevice(gladys, user, language = 'en') {
  const ids = userIds(gladys, user.username);
  const names = namesOf(language);
  const name = (key) => names[`user_${key}`];
  return {
    name: `SFTPGo ${user.username}`.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [{ name: 'USERNAME', value: user.username.slice(0, 255) }],
    features: [
      percent(name(USER_KEYS.QUOTA_USED), ids.feature(USER_KEYS.QUOTA_USED)),
      percent(name(USER_KEYS.QUOTA_FILES_USED), ids.feature(USER_KEYS.QUOTA_FILES_USED)),
      sensor(
        name(USER_KEYS.USED_SIZE),
        ids.feature(USER_KEYS.USED_SIZE),
        DEVICE_FEATURE_CATEGORIES.DATA,
        DEVICE_FEATURE_TYPES.DATA.SIZE,
        { unit: DEVICE_FEATURE_UNITS.MEGABYTE, keep_history: true, min: 0, max: MAX_SIZE_MB },
      ),
      counter(name(USER_KEYS.FILES), ids.feature(USER_KEYS.FILES)),
      counter(name(USER_KEYS.CONNECTIONS), ids.feature(USER_KEYS.CONNECTIONS)),
      counter(name(USER_KEYS.UPLOADS_TODAY), ids.feature(USER_KEYS.UPLOADS_TODAY)),
      text(name(USER_KEYS.LAST_UPLOAD), ids.feature(USER_KEYS.LAST_UPLOAD)),
      text(name(USER_KEYS.LAST_UPLOAD_TIME), ids.feature(USER_KEYS.LAST_UPLOAD_TIME)),
    ],
  };
}

const megabytes = (bytes) => Math.round((bytes / 1_000_000) * 10) / 10;
const capped = (value, max) => Math.min(Math.max(value, 0), max);
const withIds = (ids, values) =>
  values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));

/**
 * The values of the server device. Offline: only `online`. Without the event
 * log, nothing for the daily counts (unknown, not zero).
 */
export function serverValues(gladys, { online, eventLog, connections, users, today }) {
  const values = [{ key: SERVER_KEYS.ONLINE, state: online ? 1 : 0 }];
  if (online) {
    values.push(
      { key: SERVER_KEYS.EVENT_LOG, state: eventLog ? 1 : 0 },
      { key: SERVER_KEYS.CONNECTIONS, state: capped(connections.length, MAX_COUNT) },
      {
        key: SERVER_KEYS.TRANSFERS,
        state: capped(
          connections.reduce((sum, c) => sum + c.uploads + c.downloads, 0),
          MAX_COUNT,
        ),
      },
      { key: SERVER_KEYS.USERS, state: capped(users.length, MAX_COUNT) },
    );
    if (eventLog) {
      values.push(
        { key: SERVER_KEYS.UPLOADS_TODAY, state: capped(today.uploads, MAX_COUNT) },
        { key: SERVER_KEYS.FAILED_LOGINS_TODAY, state: capped(today.failedLogins, MAX_COUNT) },
      );
    }
  }
  return withIds(serverIds(gladys), values);
}

/**
 * The values of a user device: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value that is not known.
 */
export function userValues(gladys, user, { connections, eventLog, uploadsToday, last, language }) {
  const values = [
    {
      key: USER_KEYS.QUOTA_USED,
      state: capped(percentOf(user.usedSize, user.quotaSize) ?? 0, 100),
    },
    {
      key: USER_KEYS.QUOTA_FILES_USED,
      state: capped(percentOf(user.usedFiles, user.quotaFiles) ?? 0, 100),
    },
  ];
  if (user.quotaTracked) {
    values.push(
      { key: USER_KEYS.USED_SIZE, state: capped(megabytes(user.usedSize), MAX_SIZE_MB) },
      { key: USER_KEYS.FILES, state: capped(user.usedFiles, MAX_COUNT) },
    );
  }
  values.push({
    key: USER_KEYS.CONNECTIONS,
    state: capped(connections.filter((c) => c.username === user.username).length, MAX_COUNT),
  });
  if (eventLog) {
    values.push(
      { key: USER_KEYS.UPLOADS_TODAY, state: capped(uploadsToday, MAX_COUNT) },
      { key: USER_KEYS.LAST_UPLOAD, text: last ? last.path.slice(0, 255) : '-' },
      { key: USER_KEYS.LAST_UPLOAD_TIME, text: last ? formatTime(last.time, language) : '-' },
    );
  }
  return withIds(userIds(gladys, user.username), values);
}
