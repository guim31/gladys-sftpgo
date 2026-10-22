// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `recent_uploads`.
//
// The use case: a glance at the wall tablet tells whether the scan arrived, or
// what the phone sent last night. So the widget shows the files uploaded today,
// the open connections and the failed logins of the day, then the last files
// uploaded, newest first, with their user and time.
//
// Every user by default, or the ones chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): three tiles, one text (SFTPGo not answering,
// no event log, no upload yet), one status list of eight rows, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, EVENT_LOG_TEXT, formatTime, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  pick: {
    en: 'Enter the address of your SFTPGo server and an admin API key or password in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur SFTPGo et une clé d'API ou le mot de passe d'un admin dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines SFTPGo-Servers und einen API-Schlüssel oder das Passwort eines Admins in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor SFTPGo y una clave de API o la contraseña de un administrador en la configuración de la integración.',
  },
  empty: {
    en: 'No file uploaded yet.',
    fr: "Aucun fichier déposé pour l'instant.",
    de: 'Noch keine Datei hochgeladen.',
    es: 'Todavía no se ha subido ningún archivo.',
  },
  uploads: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  connections: { en: 'Connections', fr: 'Connexions', de: 'Verbindungen', es: 'Conexiones' },
  failedLogins: { en: 'Refused', fr: 'Refusées', de: 'Abgelehnt', es: 'Rechazadas' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'SFTPGo read again.',
    fr: 'SFTPGo relu.',
    de: 'SFTPGo neu gelesen.',
    es: 'SFTPGo leído de nuevo.',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The usernames the widget shows: the chosen devices, or null for every user. */
export function selectUsers(hub, settings) {
  const chosen = [settings?.users ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return null;
  }
  return new Set(
    chosen
      .map((id) => hub.find(id))
      .filter(Boolean)
      .map((user) => user.username),
  );
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const chosen = selectUsers(hub, settings);
  const shown = (username) => chosen === null || chosen.has(username);
  const today = hub.saved.today;
  const uploadsToday =
    chosen === null
      ? today.uploads
      : [...chosen].reduce((sum, username) => sum + (today.byUser[username] ?? 0), 0);
  const connections = hub.connections.filter((c) => shown(c.username)).length;
  const logOk = hub.eventLogOk;

  const components = [
    {
      type: 'value',
      value: logOk ? uploadsToday : '-',
      label: pick(TEXT.uploads, language),
      icon: 'upload',
      color: uploadsToday > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: hub.error ? '-' : connections,
      label: pick(TEXT.connections, language),
      icon: 'link',
      color: connections > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: logOk ? today.failedLogins : '-',
      label: pick(TEXT.failedLogins, language),
      icon: 'shield-off',
      color: today.failedLogins > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  ];

  const recent = hub.saved.recent.filter((upload) => shown(upload.username)).slice(0, MAX_ROWS);
  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  } else if (!logOk && hub.eventLog) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(EVENT_LOG_TEXT[hub.eventLog], language),
    });
  } else if (recent.length === 0) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.empty, language) });
  }

  if (recent.length > 0) {
    components.push({
      type: 'status',
      items: recent.map((upload) => ({
        label: fit(upload.fileName || upload.path, 40),
        value: fit(`${upload.username} · ${formatTime(upload.time, language)}`, 40),
        icon: 'file',
        color: WIDGET_COLORS.INFO,
      })),
    });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: Math.max(30, hub.config.pollIntervalMs / 1000), components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
