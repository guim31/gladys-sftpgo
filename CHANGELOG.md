# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-22

### Added

- SFTPGo in Gladys: a server device (online, uploads followed, connections,
  transfers running, users, files uploaded and logins refused today) and one
  device per user (size and files quota used, space used, files, connections,
  files uploaded today, last file uploaded and its time).
- Scene triggers: a file is uploaded (filters on users, folder and extension),
  a quota goes above the threshold of the configuration, a login is refused.
- Scene action: state of a user, with a ready-made sentence.
- Dashboard widget: the last files uploaded, with the uploads, connections and
  refused logins of the day.
- Admin API key or admin username and password; refresh every 10 seconds to 5
  minutes.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-sftpgo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-sftpgo/releases/tag/v1.0.0
