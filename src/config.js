// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One SFTPGo server, reached through the REST API of its web server (port
// 8080 by default) with the API key of an admin, or its username and password.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds: the delay of
// the "file uploaded" trigger.
export const POLL_INTERVALS = ['10', '30', '60', '300'];

// Quota thresholds offered for the "quota above the threshold" trigger, in %.
export const QUOTA_THRESHOLDS = ['70', '80', '90', '95'];

export const DEFAULT_PORT = 8080;

export const DEFAULT_CONFIG = {
  url: '',
  api_key: '',
  username: '',
  password: '',
  poll_interval: '30',
  quota_threshold: '90',
  language: 'fr',
};

// Pages of the SFTPGo web interface: a URL copied from the browser points at
// one of them, the API lives at the root.
const INTERFACE_PATH = /\/(web|api\/v2|openapi)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 8080 then), or a URL copied from the browser
 * (`http://192.0.2.10:8080/web/admin/users`). HTTP by default for a bare host.
 * A path is kept (a server behind a reverse proxy sub-path), the interface
 * pages dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  let url;
  try {
    url = new URL(bare ? `http://${value}` : value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (bare && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(INTERFACE_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const choice = (key, list) =>
    list.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const typed = text('url');
  return {
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    apiKey: text('api_key'),
    username: text('username'),
    // Never trimmed: a password may end with a space.
    password: typeof source.password === 'string' ? source.password : '',
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 1000,
    quotaThreshold: Number(choice('quota_threshold', QUOTA_THRESHOLDS)),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the configuration holds credentials: an API key, or a username and a password. */
export const hasCredentials = (config) =>
  Boolean(config.apiKey || (config.username && config.password));
