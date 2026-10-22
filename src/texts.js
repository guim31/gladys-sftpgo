// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs
// and errors, dates and sizes. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, EVENT_LOG } from './sftpgo/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your SFTPGo server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur SFTPGo dans la configuration.",
    de: 'Gib die Adresse deines SFTPGo-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor SFTPGo en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8080',
  },
  noCredentials: {
    en: 'Enter an API key, or the username and password of an SFTPGo admin, in the configuration.',
    fr: "Saisissez une clé d'API, ou l'identifiant et le mot de passe d'un admin SFTPGo, dans la configuration.",
    de: 'Gib einen API-Schlüssel oder Benutzername und Passwort eines SFTPGo-Admins in der Konfiguration ein.',
    es: 'Introduzca una clave de API, o el usuario y la contraseña de un administrador de SFTPGo, en la configuración.',
  },
};

// One short explanation per error kind (src/sftpgo/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'SFTPGo does not answer',
    fr: 'SFTPGo ne répond pas',
    de: 'SFTPGo antwortet nicht',
    es: 'SFTPGo no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use a valid certificate or http://',
    fr: 'certificat refusé : utilisez un certificat valide ou http://',
    de: 'Zertifikat abgelehnt: Nutze ein gültiges Zertifikat oder http://',
    es: 'certificado rechazado: use un certificado válido o http://',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API key, username or password refused by SFTPGo',
    fr: "clé d'API, identifiant ou mot de passe refusé par SFTPGo",
    de: 'API-Schlüssel, Benutzername oder Passwort von SFTPGo abgelehnt',
    es: 'clave de API, usuario o contraseña rechazados por SFTPGo',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'the admin needs the view_users and view_conns permissions',
    fr: "l'admin doit avoir les permissions view_users et view_conns",
    de: 'der Admin braucht die Berechtigungen view_users und view_conns',
    es: 'el administrador necesita los permisos view_users y view_conns',
  },
  [ERROR_KINDS.NOT_SFTPGO]: {
    en: 'no SFTPGo API at this address',
    fr: 'aucune API SFTPGo à cette adresse',
    de: 'keine SFTPGo-API unter dieser Adresse',
    es: 'no hay ninguna API de SFTPGo en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// Why the uploads are not followed (widget, report).
export const EVENT_LOG_TEXT = {
  [EVENT_LOG.MISSING]: {
    en: 'No event log in SFTPGo: uploads need its eventstore and eventsearch plugins.',
    fr: "Pas de journal d'événements dans SFTPGo : les dépôts exigent ses plugins eventstore et eventsearch.",
    de: 'Kein Ereignisprotokoll in SFTPGo: Uploads brauchen seine Plugins eventstore und eventsearch.',
    es: 'Sin registro de eventos en SFTPGo: las subidas requieren sus plugins eventstore y eventsearch.',
  },
  [EVENT_LOG.FORBIDDEN]: {
    en: 'The admin of the integration needs the view_events permission to follow the uploads.',
    fr: "L'admin de l'intégration doit avoir la permission view_events pour suivre les dépôts.",
    de: 'Der Admin der Integration braucht die Berechtigung view_events, um Uploads zu verfolgen.',
    es: 'El administrador de la integración necesita el permiso view_events para seguir las subidas.',
  },
  [EVENT_LOG.ERROR]: {
    en: 'The event log of SFTPGo does not answer, see the logs.',
    fr: "Le journal d'événements de SFTPGo ne répond pas, voir les logs.",
    de: 'Das Ereignisprotokoll von SFTPGo antwortet nicht, sieh in den Protokollen nach.',
    es: 'El registro de eventos de SFTPGo no responde, consulte los registros.',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (version) => `connected (${version})`,
    users: (n) => `${n} user(s)`,
    connections: (n) => `${n} connection(s)`,
    eventLog: 'uploads followed',
    noEventLog: 'uploads not followed (no event log)',
  },
  fr: {
    ok: (version) => `connecté (${version})`,
    users: (n) => `${n} utilisateur(s)`,
    connections: (n) => `${n} connexion(s)`,
    eventLog: 'dépôts suivis',
    noEventLog: "dépôts non suivis (pas de journal d'événements)",
  },
  de: {
    ok: (version) => `verbunden (${version})`,
    users: (n) => `${n} Benutzer`,
    connections: (n) => `${n} Verbindung(en)`,
    eventLog: 'Uploads werden verfolgt',
    noEventLog: 'Uploads nicht verfolgt (kein Ereignisprotokoll)',
  },
  es: {
    ok: (version) => `conectado (${version})`,
    users: (n) => `${n} usuario(s)`,
    connections: (n) => `${n} conexión(es)`,
    eventLog: 'subidas seguidas',
    noEventLog: 'subidas no seguidas (sin registro de eventos)',
  },
};

// Errors of the scene action (shown in Gladys).
export const ACTION_TEXT = {
  unknownUser: {
    en: 'This device is not an SFTPGo user.',
    fr: "Cet appareil n'est pas un utilisateur SFTPGo.",
    de: 'Dieses Gerät ist kein SFTPGo-Benutzer.',
    es: 'Este dispositivo no es un usuario de SFTPGo.',
  },
};

// The `sentence` output of "State of a user".
export const SENTENCE_TEXT = {
  en: {
    quota: (percent) => `quota ${percent} % used`,
    noQuota: 'no quota',
    lastUpload: (name, time) => `last file ${name} on ${time}`,
    noUpload: 'no file uploaded seen',
  },
  fr: {
    quota: (percent) => `quota utilisé à ${percent} %`,
    noQuota: 'sans quota',
    lastUpload: (name, time) => `dernier fichier ${name} le ${time}`,
    noUpload: 'aucun dépôt vu',
  },
  de: {
    quota: (percent) => `Kontingent zu ${percent} % belegt`,
    noQuota: 'kein Kontingent',
    lastUpload: (name, time) => `letzte Datei ${name} am ${time}`,
    noUpload: 'kein Upload gesehen',
  },
  es: {
    quota: (percent) => `cuota usada al ${percent} %`,
    noQuota: 'sin cuota',
    lastUpload: (name, time) => `último archivo ${name} el ${time}`,
    noUpload: 'ninguna subida vista',
  },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/** A date as day/month hours:minutes, in the time zone of Gladys (the supervisor injects TZ). */
export function formatTime(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

/** "1.2 GB", for a scene message. */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
