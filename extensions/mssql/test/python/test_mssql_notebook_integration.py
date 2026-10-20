# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

"""Opt-in live tests using temporary SQL objects and an optional owned container."""

import importlib.util
import json
import os
import secrets
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime
from decimal import Decimal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import mssql_python
from IPython.core.interactiveshell import InteractiveShell

from test_mssql_notebook import MESSAGES


spec = importlib.util.spec_from_file_location(
    "mssql_notebook_integration",
    Path(__file__).resolve().parents[2] / "python" / "mssql_notebook.py",
)
notebook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notebook)


@unittest.skipUnless(
    os.environ.get("MSSQL_NOTEBOOK_TEST_CONTAINER") == "1" or
    os.environ.get("MSSQL_NOTEBOOK_TEST_SERVER"),
    "Configure MSSQL_NOTEBOOK_TEST_SERVER or enable a disposable test container",
)
class DriverIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server = os.environ.get("MSSQL_NOTEBOOK_TEST_SERVER")
        if server:
            if not os.environ.get("MSSQL_NOTEBOOK_TEST_DATABASE"):
                raise RuntimeError("Integration tests require an explicit database")
            authentication = os.environ.get("MSSQL_NOTEBOOK_TEST_AUTHENTICATION", "sql")
            if authentication == "integrated":
                cls.authentication = {"kind": "integrated"}
            elif authentication == "sql":
                if any(not os.environ.get(name) for name in (
                    "MSSQL_NOTEBOOK_TEST_USER", "MSSQL_NOTEBOOK_TEST_PASSWORD",
                )):
                    raise RuntimeError("SQL authentication requires a test user and password")
                cls.authentication = {
                    "kind": "sql",
                    "username": os.environ["MSSQL_NOTEBOOK_TEST_USER"],
                    "password": os.environ["MSSQL_NOTEBOOK_TEST_PASSWORD"],
                }
            else:
                raise RuntimeError("Test authentication must be sql or integrated")
            cls.settings = {
                "server": server,
                "database": os.environ["MSSQL_NOTEBOOK_TEST_DATABASE"],
                "encrypt": "yes",
                "trustServerCertificate":
                    os.environ.get("MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE") == "1",
                "loginTimeout": 15, "queryTimeout": 5,
            }
            return
        from testcontainers.core.container import DockerContainer

        password = secrets.token_urlsafe(32) + "!Aa1"
        cls.container = (
            DockerContainer(
                "sqldbpreview-dpgaeqhmgphzd4bk.azurecr.io/azure-sql/db-dev:latest"
            )
            .with_env("ACCEPT_EULA", "Y")
            .with_env("MSSQL_SA_PASSWORD", password)
            .with_exposed_ports(1433)
            .with_kwargs(platform="linux/amd64")
        )
        cls.addClassCleanup(cls.container.stop)
        cls.container.start()
        cls.settings = {
            "server": f"{cls.container.get_container_host_ip()},{cls.container.get_exposed_port(1433)}",
            "database": "appdb",
            "encrypt": "yes",
            "trustServerCertificate": True,
            "loginTimeout": 5,
            "queryTimeout": 5,
            "applicationName": "vscode-mssql-notebook-test",
            "applicationIntent": "ReadWrite",
            "connectRetryCount": 0,
        }
        cls.authentication = {"kind": "sql", "username": "sa", "password": password}
        deadline = time.monotonic() + 120
        while True:
            try:
                connection = mssql_python.connect(
                    server=cls.settings["server"], database="master",
                    uid="sa", pwd=password, encrypt="yes",
                    trustservercertificate="yes", autocommit=True, timeout=2,
                )
            except mssql_python.Error:
                if time.monotonic() >= deadline:
                    raise RuntimeError("Test-owned Azure SQL engine did not become ready") from None
                continue
            ready = False
            try:
                cursor = connection.cursor()
                try:
                    if cursor.execute("SELECT 1").fetchone()[0] != 1:
                        raise AssertionError("SQL readiness query failed")
                    cursor.execute("IF DB_ID(N'appdb') IS NULL CREATE DATABASE appdb")
                    ready = True
                except mssql_python.Error as error:
                    if ("Database may not be activated yet or may be in transition" not in str(error)
                            or time.monotonic() >= deadline):
                        raise
                finally:
                    cursor.close()
            finally:
                connection.close()
            if ready:
                break

    def setUp(self):
        self.shell = InteractiveShell()
        configuration = {"settings": self.settings, "authentication": self.authentication}
        with patch.object(notebook, "get_ipython", return_value=self.shell), \
                patch.object(notebook.BrokerClient, "request", return_value=configuration):
            self.session = notebook.initialize("http://127.0.0.1:1234", "test-only", MESSAGES)
        self.addCleanup(self.session.close)

    def test_engine_and_selected_database(self):
        frame = self.session.query(
            "SELECT SERVERPROPERTY('EngineEdition') AS edition, DB_NAME() AS db"
        )
        self.assertEqual(frame.iloc[0, 1], self.settings["database"])
        if os.environ.get("MSSQL_NOTEBOOK_TEST_CONTAINER") == "1":
            self.assertEqual(frame.iloc[0, 0], 5)
        expected = os.environ.get("MSSQL_NOTEBOOK_TEST_ENGINE_EDITION")
        if expected:
            self.assertEqual(frame.iloc[0, 0], int(expected))
        if frame.iloc[0, 0] == 5:
            self.assertEqual(
                self.session.query("SELECT SERVERPROPERTY('Edition') AS edition").iloc[0, 0],
                "SQL Azure",
            )

    def test_saved_notebook_executes_sql_and_python_in_one_real_kernel(self):
        import nbformat
        from nbclient import NotebookClient

        configuration = {"settings": self.settings, "authentication": self.authentication}
        capability = secrets.token_urlsafe(32)

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if (self.path != "/v1/configuration"
                        or self.headers.get("Authorization") != "Bearer " + capability):
                    self.send_error(403)
                    return
                body = json.dumps(configuration).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass

        fixture = Path(__file__).with_name("mixed_sql_python.ipynb")
        document = nbformat.read(fixture, as_version=4)
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                client = NotebookClient(document, timeout=60, kernel_name="python3")
                client.km = client.create_kernel_manager()
                client.km.kernel_spec.argv[0] = sys.executable
                executed = client.execute(env={
                    **os.environ,
                    "MSSQL_NOTEBOOK_RUNTIME": str(Path(__file__).resolve().parents[2] / "python"),
                    "MSSQL_NOTEBOOK_BROKER_URL": f"http://127.0.0.1:{server.server_port}",
                    "MSSQL_NOTEBOOK_CAPABILITY": capability,
                    "MSSQL_NOTEBOOK_MESSAGES": json.dumps(MESSAGES),
                    "MSSQL_NOTEBOOK_PYTHON": sys.executable,
                    "MSSQL_NOTEBOOK_TEST_DATABASE": self.settings["database"],
                })
            finally:
                server.shutdown()
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())

        errors = [
            (index, output.ename, output.evalue)
            for index, cell in enumerate(executed.cells)
            for output in cell.get("outputs", [])
            if output.output_type == "error"
        ]
        self.assertEqual(errors, [(6, "RuntimeError", "queryProgrammingFailed")])
        code_cells = [cell for cell in executed.cells if cell.cell_type == "code"]
        self.assertEqual(
            [cell.execution_count for cell in code_cells], list(range(1, len(code_cells) + 1)),
        )
        self.assertIn("MSSQL_MIXED_NOTEBOOK_OK", "".join(
            output.get("text", "")
            for output in code_cells[-1].outputs
            if output.output_type == "stream"
        ))
        with tempfile.TemporaryDirectory(prefix="mssql-notebook-executed-") as directory:
            saved = Path(directory) / fixture.name
            nbformat.write(executed, saved)
            reopened = nbformat.read(saved, as_version=4)
            self.assertEqual(reopened.cells, executed.cells)
            contents = saved.read_text(encoding="utf-8")
            for secret in (capability, self.authentication.get("password")):
                if secret:
                    self.assertNotIn(secret, contents)

    def test_driver_values_parameters_and_duplicate_labels(self):
        value = "'; DROP TABLE no_such_table;--"
        frame = self.session.query(
            "SELECT CAST(? AS nvarchar(200)) AS value, "
            "CAST('12345678901234567890.123456789' AS decimal(38,9)) AS value, "
            "CAST(9223372036854775807 AS bigint) AS big, "
            "CAST(NULL AS nvarchar(1)) AS null_value, "
            "CAST('' AS nvarchar(1)) AS empty_value, 0x00FF AS binary_value, "
            "CAST('2026-10-16T12:30:00' AS datetime2) AS moment",
            (value,),
        )
        self.assertEqual(list(frame.columns)[:2], ["value", "value"])
        self.assertEqual(tuple(frame.iloc[0]), (
            value, Decimal("12345678901234567890.123456789"), 2**63 - 1,
            None, "", b"\x00\xff", datetime(2026, 10, 16, 12, 30),
        ))

    def test_limit_does_not_break_subsequent_queries(self):
        sql = ("SELECT TOP ({0}) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n "
               "FROM sys.all_objects a CROSS JOIN sys.all_objects b")
        self.assertEqual(len(self.session.query(sql.format(10_000))), 10_000)
        with self.assertRaisesRegex(ValueError, "limit"):
            self.session.query(sql.format(10_001))
        self.assertEqual(self.session.query("SELECT 42 AS n").iloc[0, 0], 42)

    def test_multiple_results_and_messages_only(self):
        frames = self.session.query("PRINT 'message'; SELECT 1 AS a; SELECT 2 AS b", all_results=True)
        self.assertEqual([frame.iloc[0, 0] for frame in frames], [1, 2])
        self.assertIsNone(self.session.query("PRINT 'message'"))

    def test_magic_and_python_share_temporary_tables_and_transactions(self):
        self.session.query("CREATE TABLE #notebook_values (n int)")
        self.assertIsNotNone(
            self.session.query("SELECT OBJECT_ID('tempdb..#notebook_values') AS id").iloc[0, 0],
            "A temporary table must survive the end of the creating batch",
        )
        self.session.query("BEGIN TRANSACTION")
        self.session.query("INSERT INTO #notebook_values VALUES (?)", [42])
        self.shell.run_cell_magic("tsql", "--bind df", "SELECT n FROM #notebook_values")
        self.assertEqual(self.shell.user_ns["df"].iloc[0, 0], 42)
        self.session.query("ROLLBACK")
        self.assertEqual(len(self.session.query("SELECT n FROM #notebook_values")), 0)

    def test_real_query_timeout_is_effective(self):
        self.session._query_timeout = 1
        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, "^queryOperationalFailed$"):
            self.session.query("WAITFOR DELAY '00:00:10'")
        self.assertLess(time.monotonic() - started, 8)

    def test_disconnect_removes_our_magic_and_closes_the_connection(self):
        with patch.object(notebook, "get_ipython", return_value=self.shell):
            notebook.disconnect()
        self.assertIsNone(self.shell.find_cell_magic("tsql"))
        self.assertNotIn("mssql", self.shell.user_ns)
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            self.session.query("SELECT 1")


if __name__ == "__main__":
    unittest.main()
