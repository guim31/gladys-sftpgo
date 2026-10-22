// -----------------------------------------------------------------------------
// An in-memory SFTPGo REST API (/api/v2), shaped on the answers of a real
// SFTPGo 2.7.6 (test/fixtures/sftpgo): tokens for the Basic credentials of an
// admin, an API key, users, connections and, when the "eventsearcher" plugin
// is there, the file and login events with their nanosecond timestamps.
// `request` is the seam the client takes in place of the network.
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.10:8080';
export const ADMIN = 'gladys';
export const PASSWORD = 'admin-secret';
export const API_KEY = 'Tvr6vzZKdvtCerq473Kj7m.nAQJprsyGF7mCQzf5MQMYw';

const json = (status, body) => ({ status, headers: {}, body: JSON.stringify(body) });

let sequence = 0;
const nextId = () => `dbd36ksbstus70l0l${String((sequence += 1)).padStart(3, '0')}`;

export class FakeSftpgo {
  constructor({ now = () => Date.now(), plugin = true } = {}) {
    this.now = now;
    this.plugin = plugin;
    this.version = '2.7.6';
    this.users = new Map();
    this.connections = [];
    this.fsEvents = [];
    this.logEvents = [];
    this.down = false;
    this.permissions = new Set(['view_users', 'view_conns', 'view_events']);
    this.tokens = new Set();
    this.calls = [];
    this.request = this.request.bind(this);
  }

  addUser(username, { quotaSize = 0, quotaFiles = 0, usedSize = 0, usedFiles = 0 } = {}) {
    const raw = {
      id: this.users.size + 1,
      status: 1,
      username,
      has_password: true,
      home_dir: `/srv/sftpgo/data/${username}`,
      quota_size: quotaSize,
      quota_files: quotaFiles,
      permissions: { '/': ['*'] },
      created_at: this.now(),
    };
    this.users.set(username, raw);
    this.setUsage(username, { usedSize, usedFiles });
    return raw;
  }

  setUsage(username, { usedSize, usedFiles }) {
    const raw = this.users.get(username);
    // SFTPGo omits the zero values, and tracks only the users with a quota (track_quota 2).
    delete raw.used_quota_size;
    delete raw.used_quota_files;
    if (usedSize) raw.used_quota_size = usedSize;
    if (usedFiles) raw.used_quota_files = usedFiles;
    if (usedSize || usedFiles) raw.last_quota_update = this.now();
  }

  connect(username, { protocol = 'SFTP', uploads = [] } = {}) {
    this.connections.push({
      username,
      connection_id: `${protocol}_${this.connections.length}`,
      client_version: 'SSH-2.0-OpenSSH_10.3',
      remote_address: '198.51.100.7:41514',
      connection_time: this.now(),
      last_activity: this.now(),
      protocol,
      active_transfers: uploads.map((path) => ({
        operation_type: 'upload',
        start_time: this.now(),
        size: 307200,
        path,
      })),
    });
  }

  upload(
    username,
    path,
    { size = 3_000_000, protocol = 'SFTP', time = this.now(), status = 1 } = {},
  ) {
    // The real timestamps carry nanoseconds: beyond what a double holds exactly.
    const event = {
      id: nextId(),
      timestamp: time * 1e6 + 503851,
      action: 'upload',
      username,
      fs_path: `/srv/sftpgo/data/${username}${path}`,
      virtual_path: path,
      file_size: size,
      elapsed: 35,
      status,
      protocol,
      ip: '198.51.100.7',
      session_id: `${protocol}_x_1`,
      fs_provider: 0,
    };
    this.fsEvents.push(event);
    return event;
  }

  failLogin(username, { ip = '203.0.113.9', protocol = 'SSH', time = this.now(), event = 1 } = {}) {
    this.logEvents.push({
      id: nextId(),
      timestamp: time * 1e6 + 827347,
      event,
      protocol,
      username,
      ip,
      message: 'invalid credentials',
    });
  }

  authorized(headers) {
    if (headers['x-sftpgo-api-key'] !== undefined) {
      return headers['x-sftpgo-api-key'] === API_KEY ? true : 'badkey';
    }
    const bearer = headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    return bearer && this.tokens.has(bearer);
  }

  events(list, query, filter) {
    const start = BigInt(query.get('start_timestamp') ?? '0');
    const limit = Number(query.get('limit') ?? 100);
    const selected = list
      .filter(filter)
      .filter((event) => BigInt(Math.round(event.timestamp)) >= start)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (query.get('order') !== 'ASC') {
      selected.reverse();
    }
    return selected.slice(0, limit);
  }

  async request(address, { headers = {} } = {}) {
    const url = new URL(address);
    this.calls.push(`${url.pathname}${url.search}`);
    if (this.down) {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    const path = url.pathname.replace(/^\/api\/v2/, '');
    if (path === '/token') {
      const expected = `Basic ${Buffer.from(`${ADMIN}:${PASSWORD}`).toString('base64')}`;
      if (headers.authorization !== expected) {
        return json(401, { error: 'invalid credentials', message: 'Unauthorized' });
      }
      const token = `token-${this.tokens.size + 1}`;
      this.tokens.add(token);
      return json(200, {
        access_token: token,
        expires_at: new Date(this.now() + 20 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
      });
    }
    const auth = this.authorized(headers);
    if (auth === 'badkey') {
      return json(400, { error: 'the provided api key is not valid', message: '' });
    }
    if (!auth) {
      return json(401, { error: 'no token found', message: 'Unauthorized' });
    }
    const forbidden = (permission) =>
      this.permissions.has(permission) ? null : json(403, { message: 'Forbidden' });
    const query = url.searchParams;
    switch (path) {
      case '/version':
        return json(200, { version: this.version, build_date: '2026-09-18T20:26:08Z' });
      case '/users': {
        const offset = Number(query.get('offset') ?? 0);
        const limit = Number(query.get('limit') ?? 100);
        return (
          forbidden('view_users') ??
          json(200, [...this.users.values()].slice(offset, offset + limit))
        );
      }
      case '/connections':
        return forbidden('view_conns') ?? json(200, this.connections);
      case '/events/fs':
      case '/events/logs': {
        if (!this.plugin) {
          return json(501, { error: 'no events searcher plugin defined', message: '' });
        }
        const denied = forbidden('view_events');
        if (denied) return denied;
        if (path === '/events/fs') {
          const actions = (query.get('actions') ?? '').split(',').filter(Boolean);
          const statuses = (query.get('statuses') ?? '').split(',').filter(Boolean).map(Number);
          return json(
            200,
            this.events(
              this.fsEvents,
              query,
              (e) =>
                (actions.length === 0 || actions.includes(e.action)) &&
                (statuses.length === 0 || statuses.includes(e.status)),
            ),
          );
        }
        const kinds = (query.get('events') ?? '').split(',').filter(Boolean).map(Number);
        return json(
          200,
          this.events(this.logEvents, query, (e) => kinds.length === 0 || kinds.includes(e.event)),
        );
      }
      default:
        return json(404, { message: 'Not Found' });
    }
  }
}
