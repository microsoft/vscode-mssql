# Integrated authentication with Kerberos on macOS and Linux

The MSSQL extension uses Kerberos for Integrated authentication (also called
Windows Authentication) on macOS and Linux. The client must have:

1. A valid Kerberos credential for a Windows domain account.
2. A SQL Server service principal name (SPN) that matches the server name and
   port used by the connection.

A successful `kinit` proves only that the client obtained a ticket-granting
ticket (TGT). It does not prove that Active Directory can issue a ticket for the
SQL Server service.

## Prerequisites

- The client can reach the domain's DNS and Kerberos services, directly or
  through the required VPN.
- The user's Kerberos realm and the SQL Server service account's domain are the
  same or have an appropriate trust relationship.
- The client's clock is synchronized with the domain.
- A SQL Server or Active Directory administrator can verify the SQL Server
  service account and its SPNs.
- You know the SQL Server's fully qualified domain name (FQDN) and TCP port.
  Port `1433` is used in the examples, but named instances and custom
  configurations frequently use a different port.

For current server-side requirements, see
[Register a Service Principal Name for Kerberos Connections](https://learn.microsoft.com/sql/database-engine/configure-windows/register-a-service-principal-name-for-kerberos-connections).

## 1. Verify the SQL Server SPN

For a TCP connection to `sqlhost.domain.company.com` on port `1433`, the client
requests a service ticket for:

```text
MSSQLSvc/sqlhost.domain.company.com:1433
```

From a domain-joined Windows machine, an administrator can query the exact SPN:

```cmd
setspn -Q MSSQLSvc/sqlhost.domain.company.com:1433
```

The administrator must verify that:

- The SPN exists and exactly matches the FQDN and port used by the client.
- The SPN is registered on the account that runs the SQL Server service. This
  might be a computer account, domain service account, virtual account, or
  managed service account.
- The SPN is not registered on multiple accounts.

Finding an unrelated `MSSQLSvc` entry on the SQL Server host is not sufficient.
Do not add, delete, or move an SPN without coordinating with the SQL Server and
Active Directory administrators.

## 2. Configure the Kerberos client

Many domain environments publish Kerberos configuration through DNS. If
`kinit` already works for the intended realm, do not replace a working
configuration merely to match the example below.

If DNS discovery is unavailable, configure the realm and key distribution
center (KDC) in `/etc/krb5.conf`:

```ini
[libdefaults]
  default_realm = DOMAIN.COMPANY.COM

[realms]
DOMAIN.COMPANY.COM = {
  kdc = dc-33.domain.company.com
}
```

Replace every sample value with the value for your environment. Kerberos realm
names are case-sensitive; Active Directory realms are conventionally written
in uppercase.

An administrator can discover a domain controller from a domain-joined Windows
machine:

```cmd
nltest /dsgetdc:DOMAIN.COMPANY.COM
```

### macOS

macOS includes Kerberos tools. Check which implementation your shell selects,
especially if Homebrew or another Kerberos distribution is installed:

```sh
type -a kinit klist
/usr/bin/kinit username@DOMAIN.COMPANY.COM
/usr/bin/klist
```

Use the matching `kinit` and `klist` tools when creating and inspecting a
credential cache.

### Linux

Install the Kerberos client package for your distribution. For example:

```sh
# Debian and Ubuntu
sudo apt-get update
sudo apt-get install krb5-user

# Fedora and Red Hat Enterprise Linux
sudo dnf install krb5-workstation
```

Then obtain and inspect a TGT:

```sh
kinit username@DOMAIN.COMPANY.COM
klist
```

The output should include a valid, unexpired principal such as:

```text
krbtgt/DOMAIN.COMPANY.COM@DOMAIN.COMPANY.COM
```

## 3. Connect from VS Code

1. Create or edit a connection profile.
2. Enter the SQL Server FQDN and actual TCP port. For example:
   `sqlhost.domain.company.com,1433`.
3. Select **Integrated** as the authentication type.
4. Connect.

After a successful connection, confirm that SQL Server used Kerberos:

```sql
SELECT auth_scheme
FROM sys.dm_exec_connections
WHERE session_id = @@SPID;
```

The query should return `KERBEROS`.

## Troubleshoot the credential cache

The SQL Tools Service inherits its environment when VS Code starts. Setting
`KRB5CCNAME` in an integrated terminal does not change the environment of an
already-running extension host or SQL Tools Service.

On macOS, a native `API:` cache can work with the extension. A `FILE:` cache is
an optional diagnostic, not a requirement.

To test a dedicated file-backed cache on macOS:

```sh
cache_dir="$HOME/Library/Caches/vscode-mssql"
install -d -m 700 "$cache_dir"
cache="FILE:$cache_dir/krb5cc-vscode-test"

/usr/bin/kinit -c "$cache" username@DOMAIN.COMPANY.COM
/usr/bin/klist -c "$cache"
```

On Linux, use a private user-owned runtime or cache directory:

```sh
cache_dir="${XDG_RUNTIME_DIR:-$HOME/.cache}/vscode-mssql"
install -d -m 700 "$cache_dir"
cache="FILE:$cache_dir/krb5cc-vscode-test"

kinit -c "$cache" username@DOMAIN.COMPANY.COM
klist -c "$cache"
```

Then fully quit all VS Code windows and launch the first VS Code instance from
the same terminal:

```sh
KRB5CCNAME="$cache" code
```

If the `code` command is unavailable on macOS, run **Shell Command: Install
'code' command in PATH** from the VS Code Command Palette first.

VS Code instances normally inherit environment variables from the first
running instance, not necessarily from the shell that opened each later
window. See
[Environment variables shared between VS Code instances](https://code.visualstudio.com/docs/terminal/advanced#_environment-inheritance).

For Remote SSH, WSL, or a development container, the extension and SQL Tools
Service can run remotely. Create the ticket and configure the credential cache
on the machine where the extension runs.

The credential-cache file contains usable credentials. Keep it outside source
repositories and shared directories, and do not put a password in it or create
it manually. `kinit` creates and populates it. When the diagnostic is complete,
destroy only that test cache:

```sh
kdestroy -c "$cache"
```

## Troubleshooting checklist

| Observation                                                                   | Check next                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kinit` fails                                                                 | DNS and KDC reachability, VPN connectivity, realm configuration, clock synchronization, and credentials                                                          |
| `klist` shows no valid `krbtgt` ticket                                        | Renew the TGT with the same Kerberos implementation that the application will use                                                                                |
| A TGT exists, but no `MSSQLSvc/...` ticket appears after a connection attempt | Verify the exact SQL Server FQDN, TCP port, SPN ownership, and duplicate SPNs with the administrators                                                            |
| A SQL service ticket exists, but VS Code still fails                          | Verify cache selection, fully restart VS Code, and confirm where the extension runs                                                                              |
| A file-backed cache works but the default cache does not                      | Record the selected `kinit`/`klist` implementations, cache types, OS architecture, and extension version when reporting the issue                                |
| Azure Data Studio or another client works                                     | Compare the exact server name, port, cache, process environment, and driver version; success in another client does not by itself identify the failing component |

When sharing diagnostics, redact usernames, realms, hostnames, cache
identifiers, and ticket contents. Do not upload credential-cache files.
