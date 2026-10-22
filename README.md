# SFTPGo for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings an [SFTPGo](https://sftpgo.com/) file server (SFTP, FTP/S, WebDAV,
web) into Gladys: the open connections, the users and their quotas, and a scene
trigger every time a file is uploaded — the scanner that sends a PDF, the
camera that drops a picture, the phone that backs up its photos.

- **One server device**: online, uploads followed, open connections, transfers
  running, users, files uploaded and logins refused since midnight.
- **One device per user**: size and files quota used (%), space used, files,
  open connections, files uploaded today, last file uploaded and its time.
- **Scene triggers**: a file is uploaded (filters: users, folder, extension;
  variables: user, path, file name, size, protocol…), a quota goes above the
  threshold of the configuration, a login is refused (wrong password or unknown
  user) — for any user, added to Gladys or not.
- **Scene action**: state of a user, with a ready-made sentence.
- **Dashboard widget**: the last files uploaded, with the uploads, connections
  and refused logins of the day.
- An admin API key, or the username and password of an admin.
- Texts in English, French, German and Spanish.

The uploads and the refused logins come from the **event log** of SFTPGo: its
`eventstore` and `eventsearch` plugins (Docker image `drakkan/sftpgo:plugins`,
with PostgreSQL or MySQL). Without them, the connections, users and quotas
work, and the integration says the uploads are not followed.

Tested against a real SFTPGo 2.7.6 (Docker images `drakkan/sftpgo` and
`drakkan/sftpgo:plugins` with PostgreSQL 16): uploads over SFTP and WebDAV,
quotas, failed logins, API key and admin token, with and without the event
log. Not yet tested on a real Gladys: feedback welcome on
[the issues](https://github.com/guim31/gladys-sftpgo/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- SFTPGo 2.x with its web server (REST API, port 8080 by default) reachable
  from the Gladys machine.
- An SFTPGo admin with the `view_users`, `view_conns` and `view_events`
  permissions (its API key, or its username and password).
- For the uploads: the `eventstore` and `eventsearch` plugins of SFTPGo.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-sftpgo`. Then open its configuration, enter
the address of SFTPGo and the API key (or username and password) of the admin,
and add the server and the users from the Discover tab.

The full guide, with the plugin configuration: [docs/en.md](docs/en.md) (also
in [French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads the REST API of SFTPGo (`/api/v2`) every 30 seconds by
default: the users with their quotas, the connections, and the new events of
the event log since the last read (`/events/fs` for the uploads,
`/events/logs` for the refused logins). It publishes the states of the
devices added to Gladys when they change, and fires the scene events. The
cursor of the event log is kept in `/data`, so an upload made while Gladys or
the integration restarted is still announced, once; the first read only
records. With username and password, the integration trades them for a token
of 20 minutes and renews it. Redirects are not followed.

## Limits

- No upload is seen without the event log plugins: the HTTP actions of the
  event rules of SFTPGo cannot reach the integration, which has no open port.
- An upload is announced at the next read; twenty at most per read.
- Read only: the integration changes nothing in SFTPGo.
- One SFTPGo server per configuration.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the SFTPGo
API.

## Credits

- [SFTPGo](https://github.com/drakkan/sftpgo) by Nicola Murino and its
  contributors (AGPL-3.0): the API answers in `test/fixtures/sftpgo` come from
  its Docker images. The logo on the cover is the SFTPGo logo, from its
  repository. No SFTPGo code is used.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of [gladys-kopia](https://github.com/guim31/gladys-kopia).

Not affiliated with SFTPGo or its authors.
