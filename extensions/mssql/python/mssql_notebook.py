# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

"""Runtime for explicitly authorized MSSQL Python notebooks."""

import argparse
import json
import keyword
import platform
import shlex
import time
from types import SimpleNamespace
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler, ProxyHandler, Request, build_opener,
)

import mssql_python
import pandas as pd
from IPython import get_ipython
from IPython.core.magic import Magics, cell_magic, magics_class
from IPython.display import display


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class BrokerClient:
    def __init__(self, url, capability, messages):
        parts = urlsplit(url)
        if (parts.scheme != "http" or parts.hostname != "127.0.0.1"
                or not parts.port or parts.username or parts.password
                or parts.path or parts.query or parts.fragment):
            raise ValueError(messages["brokerFailed"])
        self._url = url
        self._capability = capability
        self._messages = messages
        self._opener = build_opener(ProxyHandler({}), _NoRedirects())

    def request(self, endpoint):
        if endpoint not in ("/v1/configuration", "/v1/token"):
            raise ValueError(self._messages["brokerFailed"])
        request = Request(
            self._url + endpoint,
            data=b"{}",
            headers={
                "Authorization": "Bearer " + self._capability,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener.open(request, timeout=30) as response:
                raw = response.read(65_537)
                if len(raw) > 65_536:
                    raise ValueError(self._messages["brokerFailed"])
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise ValueError(self._messages["brokerFailed"])
                return result
        except (URLError, OSError, ValueError):
            raise RuntimeError(self._messages["brokerFailed"]) from None


class NotebookTokenProvider:
    def __init__(self, client, messages):
        self._client = client
        self._messages = messages

    def get_token(self, scope):
        if scope != "https://database.windows.net/.default":
            raise ValueError(self._messages["scope"])
        result = self._client.request("/v1/token")
        if (not isinstance(result.get("token"), str) or not result["token"]
                or not isinstance(result.get("expiresOn"), (int, float))
                or result["expiresOn"] <= time.time()):
            raise RuntimeError(self._messages["brokerFailed"])
        return SimpleNamespace(token=result["token"], expires_on=result["expiresOn"])


def _query_error_message(error, messages):
    for error_type, key in (
        (mssql_python.ProgrammingError, "queryProgrammingFailed"),
        (mssql_python.IntegrityError, "queryIntegrityFailed"),
        (mssql_python.InterfaceError, "queryInterfaceFailed"),
        (mssql_python.OperationalError, "queryOperationalFailed"),
    ):
        if isinstance(error, error_type):
            return messages[key]
    return messages["queryFailed"]


class NotebookSqlSession:
    def __init__(self, connection, messages, query_timeout):
        self._connection = connection
        self._messages = messages
        self._query_timeout = query_timeout

    @property
    def connection(self):
        if self._connection is None:
            raise RuntimeError(self._messages["disconnected"])
        return self._connection

    def query(self, sql, params=(), *, max_rows=10_000, all_results=False):
        if (not isinstance(sql, str) or not sql.strip()
                or not isinstance(all_results, bool)):
            raise ValueError(self._messages["arguments"])
        if not isinstance(params, (tuple, list)):
            raise ValueError(self._messages["parameters"])
        if type(max_rows) is not int or max_rows < 1:
            raise ValueError(self._messages["limit"])

        connection = self.connection
        cursor = None
        frames = []
        try:
            connection.timeout = self._query_timeout
            cursor = connection.cursor()
            cursor.execute(sql, params)
            while True:
                if cursor.description is not None:
                    columns = [column[0] for column in cursor.description]
                    rows = []
                    while True:
                        batch = cursor.fetchmany(min(1_000, max_rows - len(rows) + 1))
                        if not batch:
                            break
                        rows.extend(tuple(row) for row in batch)
                        if len(rows) > max_rows:
                            raise ValueError(self._messages["limit"])
                    frames.append(pd.DataFrame(rows, columns=columns, dtype=object))
                if not cursor.nextset():
                    break
            if all_results:
                return frames
            if len(frames) > 1:
                raise ValueError(self._messages["multiple"])
            return frames[0] if frames else None
        except KeyboardInterrupt:
            raise
        except mssql_python.Error as error:
            raise RuntimeError(_query_error_message(error, self._messages)) from None
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except mssql_python.Error as error:
                    raise RuntimeError(_query_error_message(error, self._messages)) from None

    def close(self):
        connection = self._connection
        self._connection = None
        if connection is not None:
            connection.close()


class _ArgumentParser(argparse.ArgumentParser):
    def __init__(self, messages):
        super().__init__(add_help=False, allow_abbrev=False)
        self._messages = messages
        self.add_argument("--bind")
        self.add_argument("--params")
        self.add_argument("--all", action="store_true")
        self.add_argument("--max-rows", type=int, default=10_000)

    def error(self, message):
        raise ValueError(self._messages["arguments"])


def _identifier(value, messages):
    if (not value.isidentifier() or keyword.iskeyword(value)
            or value.startswith("_")):
        raise ValueError(messages["identifier"])
    return value


@magics_class
class _TsqlMagic(Magics):
    def __init__(self, shell, session, messages):
        super().__init__(shell)
        self.session = session
        self.messages = messages

    @cell_magic
    def tsql(self, line, cell):
        try:
            arguments = shlex.split(line)
        except ValueError:
            raise ValueError(self.messages["arguments"]) from None
        options = _ArgumentParser(self.messages).parse_args(arguments)
        if options.bind:
            _identifier(options.bind, self.messages)
            if options.bind == "mssql":
                raise ValueError(self.messages["identifier"])
        params = ()
        if options.params:
            name = _identifier(options.params, self.messages)
            if name not in self.shell.user_ns:
                raise ValueError(self.messages["parameters"])
            params = self.shell.user_ns[name]
        result = self.session.query(
            cell, params, max_rows=options.max_rows, all_results=options.all
        )
        if options.bind:
            self.shell.user_ns[options.bind] = result
        if result is None:
            print(self.messages["noResults"])
        elif isinstance(result, list):
            for frame in result:
                display(frame)
        else:
            display(result)


def register_magic(shell, session, messages):
    if shell.find_cell_magic("tsql") is not None:
        raise RuntimeError(messages["conflict"])
    shell.register_magics(_TsqlMagic(shell, session, messages))


def initialize(url, capability, messages):
    shell = get_ipython()
    if shell is None or shell.find_cell_magic("tsql") is not None or "mssql" in shell.user_ns:
        raise RuntimeError(messages["conflict"])
    client = BrokerClient(url, capability, messages)
    configuration = client.request("/v1/configuration")
    settings = configuration["settings"]
    authentication = configuration["authentication"]
    options = {
        "server": settings["server"],
        "encrypt": settings["encrypt"],
        "trustservercertificate": "yes" if settings["trustServerCertificate"] else "no",
        "timeout": settings["loginTimeout"],
        "autocommit": True,
    }
    if settings.get("database"):
        options["database"] = settings["database"]
    if settings.get("hostNameInCertificate"):
        options["hostnameincertificate"] = settings["hostNameInCertificate"]
    for name in ("applicationName", "applicationIntent", "connectRetryCount",
                 "connectRetryInterval", "multiSubnetFailover"):
        if settings.get(name) is not None:
            value = settings[name]
            options[name.lower()] = ("yes" if value else "no") if type(value) is bool else value
    if authentication["kind"] == "sql":
        options.update(uid=authentication["username"], pwd=authentication["password"])
    elif authentication["kind"] == "integrated":
        if platform.system() != "Windows":
            raise RuntimeError(messages["windowsOnly"])
        options["trusted_connection"] = "yes"
    elif authentication["kind"] == "entra":
        options["token_provider"] = NotebookTokenProvider(client, messages)
    else:
        raise ValueError(messages["scope"])
    try:
        connection = mssql_python.connect(**options)
    except mssql_python.Error:
        raise RuntimeError(messages["connectFailed"]) from None
    session = NotebookSqlSession(connection, messages, settings["queryTimeout"])
    try:
        register_magic(shell, session, messages)
        shell.user_ns["mssql"] = session
    except BaseException:
        session.close()
        raise
    return session


def disconnect():
    shell = get_ipython()
    if shell is None:
        return
    magic = shell.find_cell_magic("tsql")
    if magic is not None and isinstance(getattr(magic, "__self__", None), _TsqlMagic):
        session = magic.__self__.session
        session.close()
        del shell.magics_manager.magics["cell"]["tsql"]
        if shell.user_ns.get("mssql") is session:
            del shell.user_ns["mssql"]
