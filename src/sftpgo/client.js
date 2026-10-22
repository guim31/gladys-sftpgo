// -----------------------------------------------------------------------------
// SFTPGo client: the REST API of its web server (`/api/v2`), checked against a
// real SFTPGo 2.7.6 (Docker images `drakkan/sftpgo` and `drakkan/sftpgo:plugins`).
//
//   GET /api/v2/token            Basic credentials of an admin -> a JWT (20 min)
//   GET /api/v2/version          { version }
//   GET /api/v2/users            the users, with their quotas (paginated)
//   GET /api/v2/connections      the open connections and their transfers
//   GET /api/v2/events/fs        the file events (uploads): HTTP 501 without an
//                                "eventsearcher" plugin
//   GET /api/v2/events/logs      the login events (failed logins), same plugin
//
// Either an API key of an admin (header X-SFTPGO-API-KEY, the admin must allow
// API key authentication), or the username and password of an admin, traded
// for a token that is renewed before it expires and again when refused.
// Permissions needed: view_users, view_conns, and view_events for the log.
// Redirects are not followed.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // credentials or API key refused
  FORBIDDEN: 'forbidden', // the admin lacks a permission
  NOT_SFTPGO: 'not_sftpgo', // something answers, not the SFTPGo API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

// State of the event log (/events/fs and /events/logs).
export const EVENT_LOG = Object.freeze({
  OK: 'ok',
  MISSING: 'missing', // no "eventsearcher" plugin (HTTP 501)
  FORBIDDEN: 'forbidden', // the admin lacks view_events
  ERROR: 'error', // anything else (the database of the plugin is down…)
});

export class SftpgoError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'SftpgoError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const PAGE_SIZE = 500;
// Pages read in one cycle, per list: 2,500 users, or 2,500 events since the last read.
export const MAX_PAGES = 5;
// A token is renewed this long before it expires.
const TOKEN_MARGIN_MS = 120_000;
const TOKEN_LIFETIME_MS = 20 * 60_000;

/**
 * The one function that talks to the network. The client takes it as a
 * parameter: the tests replace it with an in-memory SFTPGo
 * (test/helpers/fakeSftpgo.js).
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export function httpRequest(address, { method = 'GET', headers = {}, timeoutMs = 15_000 } = {}) {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      { method, headers, timeout: timeoutMs, agent: false },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            response.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    const timeout = () =>
      request.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }));
    request.on('timeout', timeout);
    // `timeout` above is an idle timeout: a server that trickles bytes is cut here.
    const deadline = setTimeout(timeout, timeoutMs);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end();
  });
}

// --- Parsing ---------------------------------------------------------------------

const count = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
const text = (value) => (typeof value === 'string' ? value : '');

/** A user, as the integration needs it. Quotas absent from the answer are 0. */
export function normalizeUser(raw) {
  return {
    username: raw.username,
    enabled: raw.status === 1,
    quotaSize: count(raw.quota_size),
    quotaFiles: count(raw.quota_files),
    usedSize: count(raw.used_quota_size),
    usedFiles: count(raw.used_quota_files),
    // Only written by SFTPGo when it tracks the quota of this user.
    quotaTracked: raw.last_quota_update > 0 || raw.quota_size > 0 || raw.quota_files > 0,
    lastLogin: count(raw.last_login) || null,
  };
}

export function normalizeConnection(raw) {
  const transfers = Array.isArray(raw.active_transfers) ? raw.active_transfers : [];
  return {
    username: text(raw.username),
    protocol: text(raw.protocol),
    uploads: transfers.filter((t) => t?.operation_type === 'upload').length,
    downloads: transfers.filter((t) => t?.operation_type === 'download').length,
  };
}

/** Nanoseconds to milliseconds (the precision lost by JSON.parse is below 1 µs). */
const toMs = (ns) => Math.floor(ns / 1e6);

/** An upload of /events/fs. */
export function normalizeUpload(raw) {
  const path = text(raw.virtual_path) || '/';
  const slash = path.lastIndexOf('/');
  const fileName = path.slice(slash + 1);
  const dot = fileName.lastIndexOf('.');
  return {
    id: text(raw.id),
    time: toMs(raw.timestamp),
    username: text(raw.username),
    path,
    folder: slash > 0 ? path.slice(0, slash) : '/',
    fileName,
    extension: dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '',
    size: count(raw.file_size),
    protocol: text(raw.protocol),
    ip: text(raw.ip),
  };
}

/** A failed login of /events/logs (1: wrong credentials, 2: unknown user). */
export function normalizeLoginFailure(raw) {
  return {
    id: text(raw.id),
    time: toMs(raw.timestamp),
    username: text(raw.username),
    unknownUser: raw.event === 2,
    protocol: text(raw.protocol),
    ip: text(raw.ip),
    message: text(raw.message).slice(0, 200),
  };
}

const validEvent = (raw) =>
  raw && typeof raw === 'object' && typeof raw.id === 'string' && Number.isFinite(raw.timestamp);

export class SftpgoClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.apiKey] API key of an admin
   * @param {string} [options.username] admin username (without API key)
   * @param {string} [options.password] admin password
   * @param {typeof httpRequest} [options.request] test seam
   * @param {() => number} [options.now]
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    apiKey = '',
    username = '',
    password = '',
    request = httpRequest,
    now = () => Date.now(),
    timeoutMs = 15_000,
  }) {
    this.url = url;
    this.apiKey = apiKey;
    this.basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.request = request;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.token = null; // { value, expiresAt }
  }

  async send(path, headers) {
    try {
      return await this.request(`${this.url}${path}`, {
        headers: { accept: 'application/json', ...headers },
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new SftpgoError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new SftpgoError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
  }

  static check(response) {
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new SftpgoError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    // An unknown API key is a 400 ("the provided api key is not valid").
    if (status === 401 || (status === 400 && /api key/i.test(response.body))) {
      throw new SftpgoError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})`, { status });
    }
    if (status === 403) {
      throw new SftpgoError(ERROR_KINDS.FORBIDDEN, 'Permission missing (HTTP 403)', { status });
    }
    if (status === 404) {
      throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'Not found (HTTP 404)', { status });
    }
    if (status < 200 || status >= 300) {
      throw new SftpgoError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
  }

  static json(response) {
    try {
      return JSON.parse(response.body);
    } catch {
      throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not JSON');
    }
  }

  async login() {
    const response = await this.send('/api/v2/token', { authorization: this.basic });
    SftpgoClient.check(response);
    const data = SftpgoClient.json(response);
    if (typeof data?.access_token !== 'string') {
      throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not a token');
    }
    // Lifetime 20 minutes: the clocks of SFTPGo and of the container may differ,
    // the expiry it gives only shortens it.
    const expires = Date.parse(data.expires_at);
    const max = this.now() + TOKEN_LIFETIME_MS;
    this.token = {
      value: data.access_token,
      expiresAt:
        Number.isFinite(expires) && expires > this.now() + 2 * TOKEN_MARGIN_MS
          ? Math.min(expires, max)
          : max,
    };
  }

  async authorization() {
    if (this.apiKey) {
      return { 'x-sftpgo-api-key': this.apiKey };
    }
    if (!this.token || this.now() >= this.token.expiresAt - TOKEN_MARGIN_MS) {
      await this.login();
    }
    return { authorization: `Bearer ${this.token.value}` };
  }

  /** The raw answer of an API call; logs in again once when the token is refused. */
  async raw(path) {
    let response = await this.send(`/api/v2${path}`, await this.authorization());
    if (response.status === 401 && !this.apiKey) {
      // SFTPGo restarted (its signing key changed), or the token was revoked.
      this.token = null;
      response = await this.send(`/api/v2${path}`, await this.authorization());
    }
    return response;
  }

  async call(path) {
    const response = await this.raw(path);
    SftpgoClient.check(response);
    return SftpgoClient.json(response);
  }

  async version() {
    const data = await this.call('/version');
    if (typeof data?.version !== 'string') {
      throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not an SFTPGo version');
    }
    return data.version;
  }

  async users() {
    const users = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await this.call(
        `/users?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}&order=ASC`,
      );
      if (!Array.isArray(data)) {
        throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not a user list');
      }
      users.push(
        ...data.filter((u) => typeof u?.username === 'string' && u.username).map(normalizeUser),
      );
      if (data.length < PAGE_SIZE) {
        break;
      }
    }
    return users;
  }

  async connections() {
    const data = await this.call('/connections');
    if (!Array.isArray(data)) {
      throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not a connection list');
    }
    return data.filter((c) => c && typeof c === 'object').map(normalizeConnection);
  }

  /**
   * Events of the log, oldest first, from `sinceMs` (included). `seen`: ids
   * already handled, skipped (the hub reads again the last 30 seconds).
   * @returns {Promise<{ state: string, events: object[], truncated?: boolean }>}
   */
  async events(kind, { sinceMs = 0, seen = new Set(), newest = false } = {}) {
    const [endpoint, filter, normalize] =
      kind === 'uploads'
        ? ['/events/fs', 'actions=upload&statuses=1', normalizeUpload]
        : ['/events/logs', 'events=1,2', normalizeLoginFailure];
    const events = [];
    let since = sinceMs;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // `newest`: one page of the most recent ones (the first read).
      const order = newest ? 'DESC' : 'ASC';
      const start = since > 0 ? `&start_timestamp=${since}000000` : '';
      const response = await this.raw(
        `${endpoint}?${filter}&order=${order}&limit=${PAGE_SIZE}${start}`,
      );
      if (response.status === 501) {
        return { state: EVENT_LOG.MISSING, events: [] };
      }
      if (response.status === 403) {
        return { state: EVENT_LOG.FORBIDDEN, events: [] };
      }
      SftpgoClient.check(response);
      const data = SftpgoClient.json(response);
      if (!Array.isArray(data)) {
        throw new SftpgoError(ERROR_KINDS.NOT_SFTPGO, 'The answer is not an event list');
      }
      const fresh = data.filter(validEvent).map(normalize);
      for (const event of fresh) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          events.push(event);
        }
      }
      if (newest || data.length < PAGE_SIZE) {
        return { state: EVENT_LOG.OK, events: newest ? events.reverse() : events };
      }
      const last = fresh.at(-1)?.time ?? since;
      if (last <= since) {
        break; // a full page within one millisecond: nothing more to page through
      }
      since = last;
    }
    return { state: EVENT_LOG.OK, events, truncated: true };
  }
}
