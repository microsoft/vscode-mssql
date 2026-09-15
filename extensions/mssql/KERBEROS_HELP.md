In order to use Integrated Authentication (also known as Windows Authentication) on macOS or Linux, you need to set up a Kerberos ticket that links your current user to a Windows domain account. A summary of the key steps is included below.

# Setup Kerberos on macOS

## Requirements

- Access to a Windows domain-joined machine, or assistance from a SQL Server or Active Directory administrator, to query your Kerberos domain and SQL Server service principal names (SPNs).
- SQL Server must be configured to allow Kerberos authentication. For the client driver running on Unix, integrated authentication is only supported using Kerberos. There must be an SPN registered for each instance of SQL Server you are trying to connect to. For current setup instructions and SPN formats, see [Register a Service Principal Name for Kerberos Connections](https://learn.microsoft.com/sql/database-engine/configure-windows/register-a-service-principal-name-for-kerberos-connections).
- The client must be able to reach the domain's DNS and Kerberos services, either directly or through the required VPN.
- The client's clock must be synchronized with the domain.

### Check if SQL Server has Kerberos set up

For a TCP connection, the expected SPN includes the SQL Server fully qualified domain name (FQDN) and port. For example:

```text
MSSQLSvc/sqlhost.domain.company.com:1433
```

From a domain-joined Windows machine, an administrator can query the exact SPN:

```cmd
setspn -Q MSSQLSvc/sqlhost.domain.company.com:1433
```

The SPN must exactly match the FQDN and port used by the client, must be registered on the account that runs the SQL Server service, and must not be registered on multiple accounts. Finding an unrelated `MSSQLSvc` entry on the SQL Server host is not sufficient.

Do not add, remove, or move an SPN without coordinating with the SQL Server and Active Directory administrators.

## Steps to set up Integrated Authentication

### Step 1: Find the Kerberos KDC (Key Distribution Center)

- **Run on**: Windows command line
- **Action**: `nltest /dsgetdc:DOMAIN.COMPANY.COM` (where `DOMAIN.COMPANY.COM` maps to your domain's name)
- **Sample output**

    ```text
    DC: \\dc-33.domain.company.com
    Address: \\2111:4444:2111:33:1111:ecff:ffff:3333
    ...
    The command completed successfully
    ```

- **Information to extract**: The DC name, in this case `dc-33.domain.company.com`.

Many domain environments publish Kerberos configuration through DNS. If `kinit` already works for the intended realm, do not replace a working configuration merely to match this example.

### Step 2: Configure the KDC in krb5.conf

- **Run on**: macOS
- **Action**: If DNS discovery is unavailable, edit `/etc/krb5.conf` in an editor of your choice and configure the following keys:

    ```ini
    [libdefaults]
      default_realm = DOMAIN.COMPANY.COM

    [realms]
    DOMAIN.COMPANY.COM = {
      kdc = dc-33.domain.company.com
    }
    ```

    Then save the `krb5.conf` file and exit.

    **Note**: Replace every sample value with the value for your environment. Kerberos realm names are case-sensitive; Active Directory realms are conventionally written in uppercase.

### Step 3: Test Ticket Granting Ticket retrieval

- **Run on**: macOS
- **Action**:
    - If more than one Kerberos distribution is installed, use `type -a kinit klist` to check which tools your shell selects. Use matching `kinit` and `klist` implementations.
    - Use `/usr/bin/kinit username@DOMAIN.COMPANY.COM` to get a Ticket Granting Ticket (TGT) from the KDC. You will be prompted for your domain password.
    - Use `/usr/bin/klist` to see the available tickets. If `kinit` was successful, you should see a valid, unexpired ticket such as `krbtgt/DOMAIN.COMPANY.COM@DOMAIN.COMPANY.COM`.

A TGT proves that the client authenticated to the domain. It does not prove that Active Directory can issue a ticket for the SQL Server service.

### Step 4: Connect in VS Code

- Create a new connection profile.
- Enter the SQL Server FQDN and actual TCP port, for example `sqlhost.domain.company.com,1433`. Port `1433` is only an example; named instances and custom configurations might use a different port.
- Choose `Integrated` as the authentication type.
- Connect.

After a successful connection, confirm that SQL Server used Kerberos:

```sql
SELECT auth_scheme
FROM sys.dm_exec_connections
WHERE session_id = @@SPID;
```

The query should return `KERBEROS`.

# Setup Kerberos on Linux

### Step 0: Install the Kerberos client package

- **Run on**: Linux
- **Action**:

    ```sh
    # Debian and Ubuntu
    sudo apt-get update
    sudo apt-get install krb5-user

    # Fedora and Red Hat Enterprise Linux
    sudo dnf install krb5-workstation
    ```

### Step 1: Find the Kerberos KDC (Key Distribution Center)

- **Run on**: Windows command line
- **Action**: `nltest /dsgetdc:DOMAIN.COMPANY.COM` (where `DOMAIN.COMPANY.COM` maps to your domain's name)
- **Sample output**

    ```text
    DC: \\dc-33.domain.company.com
    Address: \\2111:4444:2111:33:1111:ecff:ffff:3333
    ...
    The command completed successfully
    ```

- **Information to extract**: The DC name, in this case `dc-33.domain.company.com`.

Many domain environments publish Kerberos configuration through DNS. If `kinit` already works for the intended realm, do not replace a working configuration merely to match this example.

### Step 2: Configure the KDC in krb5.conf

- **Run on**: Linux
- **Action**: If DNS discovery is unavailable, edit `/etc/krb5.conf` in an editor of your choice and configure the following keys:

    ```ini
    [libdefaults]
      default_realm = DOMAIN.COMPANY.COM

    [realms]
    DOMAIN.COMPANY.COM = {
      kdc = dc-33.domain.company.com
    }
    ```

    Then save the `krb5.conf` file and exit.

    **Note**: Replace every sample value with the value for your environment. Kerberos realm names are case-sensitive; Active Directory realms are conventionally written in uppercase.

### Step 3: Test Ticket Granting Ticket retrieval

- **Run on**: Linux
- **Action**:
    - Use `kinit username@DOMAIN.COMPANY.COM` to get a TGT from the KDC. You will be prompted for your domain password.
    - Use `klist` to see the available tickets. If `kinit` was successful, you should see a valid, unexpired ticket such as `krbtgt/DOMAIN.COMPANY.COM@DOMAIN.COMPANY.COM`.

A TGT proves that the client authenticated to the domain. It does not prove that Active Directory can issue a ticket for the SQL Server service.

### Step 4: Connect in VS Code

- Create a new connection profile.
- Enter the SQL Server FQDN and actual TCP port, for example `sqlhost.domain.company.com,1433`.
- Choose `Integrated` as the authentication type.
- Connect.

After connecting, run the query from the macOS instructions and verify that `auth_scheme` is `KERBEROS`.

# Troubleshoot the credential cache

The SQL Tools Service inherits its environment when VS Code starts. Setting `KRB5CCNAME` in an integrated terminal does not change the environment of an already-running extension host or SQL Tools Service.

On macOS, a native `API:` cache can work with the extension. A `FILE:` cache is an optional diagnostic, not a requirement. To test a dedicated file-backed cache:

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

Then fully quit all VS Code windows and launch the first VS Code instance from the same terminal:

```sh
KRB5CCNAME="$cache" code
```

VS Code instances normally inherit environment variables from the first running instance, not necessarily from the shell that opened each later window. See [Environment variables shared between VS Code instances](https://code.visualstudio.com/docs/terminal/advanced#_environment-inheritance).

For Remote SSH, WSL, or a development container, create the ticket and configure the credential cache on the machine where the extension runs.

The credential-cache file contains usable credentials. Keep it outside source repositories and shared directories. Do not create it manually or put a password in it; `kinit` creates and populates it. When the diagnostic is complete, destroy only the test cache:

```sh
kdestroy -c "$cache"
```

If `klist` shows a TGT but no `MSSQLSvc/...` ticket appears after a connection attempt, ask the administrators to verify the exact SQL Server FQDN, TCP port, SPN owner, and duplicate SPNs. If a SQL service ticket exists but VS Code still fails, verify the selected credential cache, fully restart VS Code, and confirm which machine runs the extension.

When sharing diagnostics, redact usernames, realms, hostnames, cache identifiers, and ticket contents. Do not upload credential-cache files.
