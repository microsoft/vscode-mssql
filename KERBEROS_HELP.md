In order to use Integrated Authentication (aka Windows Authentication) on macOS or Linux you will need to setup a Kerberos ticket linking your current user to a Windows domain account. A summary of key steps are included below.

# Setup Kerberos on Mac

## Requirements
Access to a Windows domain-joined machine in order to query your Kerberos Domain Controller

## Steps to set up Integrated Authentication

### Step 1: Find Kerberos KDC (Key Distribution Center)
- **Run on**: Windows Domain, Windows command line
- **Action**: `nltest /dsgetdc:DOMAIN.COMPANY.COM` (where “DOMAIN.COMPANY.COM” maps to your domain’s name)
- **Sample Output**
  ```
  DC: \\dc-33.domain.company.com
  Address: \\2111:4444:2111:33:1111:ecff:ffff:3333
  ...
  The command completed successfully
  ```
- **Information to extract**
  The DC name, in this case `dc-33.domain.company.com`

### Step 2: Configuring KDC in krb5.conf
- **Run on**: MAC
- **Action**: Edit the /etc/krb5.conf in an editor of your choice. Configure the following keys
  ```
  [libdefaults]
    default_realm = DOMAIN.COMPANY.COM
   
  [realms]
  DOMAIN.COMPANY.COM = {
     kdc = dc-33.domain.company.com
  }
  ```
  Then save the krb5.conf file and exit

  **Note** Domain must be in ALL CAPS

### Step 3: Testing the Ticket Granting Ticket retrieval
- **Run on**: Mac
- **Action**:
  - Use the command `kinit username@DOMAIN.COMPANY.COM` to get a TGT from KDC. You will be prompted for your domain password.
  - Use `klist` to see the available tickets. If the kinit was successful, you should see a ticket from krbtgt/DOMAIN.COMPANY.COM@ DOMAIN.COMPANY.COM.

### Step 4: Connect in VSCode
- Create a new connection profile
- Choose `Integrated` as the authentication type
- If all goes well and the steps above worked, you should be able to connect successfully!


# Setup Kerberos on Linux

### Step 0: Install krb5-user package
- **Run on**: Linux
- **Action**: `apt-get krb5-user`

### Step 1: Find Kerberos KDC (Key Distribution Center)
- **Run on**: Windows command line
- **Action**: `nltest /dsgetdc:DOMAIN.COMPANY.COM` (where “DOMAIN.COMPANY.COM” maps to your domain’s name)
- **Sample Output**
  ```
  DC: \\dc-33.domain.company.com
  Address: \\2111:4444:2111:33:1111:ecff:ffff:3333
  ...
  The command completed successfully
  ```
- **Information to extract**
  The DC name, in this case `co1-red-dc-33.domain.company.com`

### Step 2: Configuring KDC in krb5.conf
- **Run on**: Linux
- **Action**: Edit the /etc/krb5.conf in an editor of your choice. Configure the following keys
  ```
  [libdefaults]
    default_realm = DOMAIN.COMPANY.COM
   
  [realms]
  DOMAIN.COMPANY.COM = {
     kdc = dc-33.domain.company.com
  }
  ```
  Then save the krb5.conf file and exit

  **Note** Domain must be in ALL CAPS

### Step 3: Testing the Ticket Granting Ticket retrieval
- **Run on**: Linux
- **Action**:
  - Use the command `kinit username@DOMAIN.COMPANY.COM` to get a TGT from KDC. You will be prompted for your domain password.
  - Use `klist` to see the available tickets. If the kinit was successful, you should see a ticket from krbtgt/DOMAIN.COMPANY.COM@ DOMAIN.COMPANY.COM.

### Step 4: Connect in VSCode
- Create a new connection profile
- Choose `Integrated` as the authentication type
- If all goes well and the steps above worked, you should be able to connect successfully!
