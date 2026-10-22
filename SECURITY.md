# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- in the Gladys configuration: the address of SFTPGo and the API key or the
  password of an SFTPGo admin (secret fields, never logged). An admin limited
  to `view_users`, `view_conns` and `view_events` is enough: it cannot change
  anything in SFTPGo;
- in `/data/sftpgo-state.json`: the address of the server, the cursors of the
  event log, the counts of the day, the last files uploaded (user, path, size,
  time) and which users are above their quota threshold. No credentials;
- on the network: requests to the SFTPGo REST API only, on the local network,
  over HTTP or HTTPS. Redirects are not followed, so the credentials are never
  sent to another host.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and SFTPGo and its plugins.
