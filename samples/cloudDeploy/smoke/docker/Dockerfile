# Cloud Deploy smoke harness — SQL Server 2022 + tSQLt
#
# Extends the official SQL Server 2022 image with the sqlcmd client tools and
# a set of init scripts that create SmokeDb, install tSQLt, and define one
# passing + one failing test. Used by the UnitTests + Connectivity validators
# in the Cloud Deploy end-to-end smoke (see ../../README.md and
# planning/testing/smoke-test.md §6.3).
#
# 10-install-tsqlt.sql is the vendored tSQLt install script (V1.0.8083.3529,
# Apache-2.0). See init/README.md to refresh it.

FROM mcr.microsoft.com/mssql/server:2022-latest

# The server image does not ship the sqlcmd client; install mssql-tools18.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl gnupg2 apt-transport-https ca-certificates \
    && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
    && curl -fsSL https://packages.microsoft.com/config/ubuntu/22.04/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends mssql-tools18 unixodbc-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="${PATH}:/opt/mssql-tools18/bin"

COPY init/ /opt/init/
RUN chmod +x /opt/init/*.sh

USER mssql
ENV ACCEPT_EULA=Y
ENV MSSQL_PID=Developer

ENTRYPOINT ["/bin/bash", "/opt/init/entrypoint.sh"]
