# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

import importlib.util
import json
import threading
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
import mssql_python
from IPython.core.interactiveshell import InteractiveShell


spec = importlib.util.spec_from_file_location(
    "mssql_notebook",
    Path(__file__).resolve().parents[2] / "python" / "mssql_notebook.py",
)
notebook = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notebook)


MESSAGES = {
    key: key
    for key in (
        "arguments", "parameters", "identifier", "limit", "multiple", "disconnected",
        "queryFailed", "connectFailed", "brokerFailed", "conflict", "scope",
        "windowsOnly", "noResults", "cancelled",
        "queryProgrammingFailed", "queryIntegrityFailed", "queryOperationalFailed",
        "queryInterfaceFailed",
    )
}


class Cursor:
    def __init__(self, sets):
        self.sets = sets
        self.index = 0
        self.position = 0
        self.execute = Mock()
        self.close = Mock()
        self.failure = None

    @property
    def description(self):
        names, _ = self.sets[self.index]
        return [(name,) for name in names] if names is not None else None

    def fetchmany(self, count):
        if self.failure:
            raise self.failure
        rows = self.sets[self.index][1]
        result = rows[self.position:self.position + count]
        self.position += len(result)
        return result

    def nextset(self):
        self.index += 1
        self.position = 0
        return self.index < len(self.sets)


class NotebookTests(unittest.TestCase):
    def setUp(self):
        self.cursor = Cursor([(["value"], [(1,)])])
        self.connection = SimpleNamespace(
            cursor=Mock(return_value=self.cursor), close=Mock()
        )
        self.session = notebook.NotebookSqlSession(self.connection, MESSAGES, 30)

    def test_parameters_are_passed_to_driver_without_interpolation(self):
        value = "'; DROP TABLE users;--"
        self.session.query("SELECT ? AS value", (value,))
        self.cursor.execute.assert_called_once_with("SELECT ? AS value", (value,))

    def test_values_and_duplicate_columns_are_preserved(self):
        values = (
            Decimal("12345678901234567890.123456789"),
            2**63 - 1, None, "", b"\x00\xff", datetime(2026, 10, 16, 12, 30),
        )
        self.cursor.sets = [(["value"] * len(values), [values])]
        frame = self.session.query("SELECT values")
        self.assertIsInstance(frame, pd.DataFrame)
        self.assertEqual(list(frame.columns), ["value"] * len(values))
        self.assertEqual(tuple(frame.iloc[0]), values)
        self.assertIsInstance(frame.iloc[0, 0], Decimal)
        self.assertIsNone(frame.iloc[0, 2])

    def test_empty_tabular_result_keeps_schema(self):
        self.cursor.sets = [(["value"], [])]
        frame = self.session.query("SELECT value WHERE 1=0")
        self.assertEqual(list(frame.columns), ["value"])
        self.assertEqual(len(frame), 0)

    def test_default_limit_accepts_exactly_ten_thousand_rows(self):
        self.cursor.sets = [(["value"], [(i,) for i in range(10_000)])]
        self.assertEqual(len(self.session.query("SELECT values")), 10_000)

    def test_default_limit_rejects_ten_thousand_and_one(self):
        self.cursor.sets = [(["value"], [(i,) for i in range(10_001)])]
        with self.assertRaisesRegex(ValueError, "limit"):
            self.session.query("SELECT values")
        self.cursor.close.assert_called_once()

    def test_explicit_limit(self):
        self.cursor.sets = [(["value"], [(1,), (2,)])]
        self.assertEqual(len(self.session.query("SELECT values", max_rows=2)), 2)

    def test_invalid_limits_and_parameters_are_rejected_before_execution(self):
        for value in (0, -1, True, "10", 1.5):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.session.query("SELECT 1", max_rows=value)
        for value in ("text", b"bytes", {"value": 1}, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.session.query("SELECT ?", value)
        self.cursor.execute.assert_not_called()

    def test_multiple_results_require_explicit_all(self):
        self.cursor.sets = [(["one"], [(1,)]), (["two"], [(2,)])]
        with self.assertRaisesRegex(ValueError, "multiple"):
            self.session.query("SELECT 1; SELECT 2")

    def test_all_results_are_ordered_and_non_tabular_sets_are_skipped(self):
        self.cursor.sets = [(None, []), (["one"], [(1,)]), (["two"], [(2,)])]
        frames = self.session.query("UPDATE; SELECT 1; SELECT 2", all_results=True)
        self.assertEqual([list(frame.columns) for frame in frames], [["one"], ["two"]])

    def test_non_tabular_statement_does_not_manufacture_a_dataframe(self):
        self.cursor.sets = [(None, [])]
        self.assertIsNone(self.session.query("UPDATE values"))

    def test_query_failure_does_not_echo_driver_message(self):
        self.cursor.failure = RuntimeError("password=synthetic-secret")
        self.cursor.failure = mssql_python.Error(str(self.cursor.failure), "")
        with self.assertRaisesRegex(RuntimeError, "^queryFailed$") as error:
            self.session.query("SELECT values")
        self.assertIsNone(error.exception.__cause__)
        self.assertTrue(error.exception.__suppress_context__)
        self.cursor.close.assert_called_once()

    def test_keyboard_interrupt_closes_the_cursor_and_propagates(self):
        self.cursor.failure = KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            self.session.query("WAITFOR")
        self.cursor.close.assert_called_once()

    def test_query_errors_keep_safe_categories_without_echoing_driver_text(self):
        for error_type, expected in (
            (mssql_python.ProgrammingError, "queryProgrammingFailed"),
            (mssql_python.IntegrityError, "queryIntegrityFailed"),
            (mssql_python.OperationalError, "queryOperationalFailed"),
            (mssql_python.InterfaceError, "queryInterfaceFailed"),
        ):
            with self.subTest(error_type=error_type):
                self.cursor.failure = error_type("synthetic-password-and-SQL", "")
                with self.assertRaisesRegex(RuntimeError, "^" + expected + "$") as error:
                    self.session.query("SELECT values")
                self.assertTrue(error.exception.__suppress_context__)
                self.assertNotIn("synthetic", str(error.exception))

    def test_cursor_creation_failure_does_not_expose_driver_credentials(self):
        self.connection.cursor.side_effect = mssql_python.InterfaceError("synthetic-secret", "")
        with self.assertRaisesRegex(RuntimeError, "^queryInterfaceFailed$"):
            self.session.query("SELECT values")

    def test_cursor_close_failure_does_not_expose_driver_credentials(self):
        self.cursor.close.side_effect = mssql_python.InterfaceError("synthetic-secret", "")
        with self.assertRaisesRegex(RuntimeError, "^queryInterfaceFailed$"):
            self.session.query("SELECT values")

    def test_query_timeout_is_set_on_connection_before_creating_cursor(self):
        self.connection.cursor.side_effect = lambda: (
            self.assertEqual(self.connection.timeout, 30) or self.cursor
        )
        self.session.query("SELECT 1")

    def test_close_is_idempotent_and_queries_then_fail(self):
        self.session.close()
        self.session.close()
        self.connection.close.assert_called_once()
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            self.session.query("SELECT 1")

    def test_magic_binds_only_after_success(self):
        shell = InteractiveShell()
        notebook.register_magic(shell, self.session, MESSAGES)
        previous = object()
        shell.user_ns["df"] = previous
        self.cursor.sets = [(["value"], [(i,) for i in range(10_001)])]
        with self.assertRaises(ValueError):
            shell.run_cell_magic("tsql", "--bind df", "SELECT values")
        self.assertIs(shell.user_ns["df"], previous)

    def test_magic_uses_named_parameter_sequence(self):
        shell = InteractiveShell()
        shell.user_ns["query_values"] = [42]
        notebook.register_magic(shell, self.session, MESSAGES)
        shell.run_cell_magic("tsql", "--bind df --params query_values", "SELECT ?")
        self.cursor.execute.assert_called_once_with("SELECT ?", [42])
        self.assertEqual(shell.user_ns["df"].iloc[0, 0], 1)

    def test_magic_rejects_expressions_and_reserved_names(self):
        shell = InteractiveShell()
        notebook.register_magic(shell, self.session, MESSAGES)
        for arguments in ("--bind a.b", "--bind __name__", "--bind class",
                          "--params values[0]", "--unknown", "--max-rows 0"):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                shell.run_cell_magic("tsql", arguments, "SELECT 1")
        self.cursor.execute.assert_not_called()

    def test_magic_conflict_does_not_replace_existing_provider(self):
        shell = InteractiveShell()
        original = lambda line, cell: None
        shell.register_magic_function(original, "cell", "tsql")
        with self.assertRaisesRegex(RuntimeError, "conflict"):
            notebook.register_magic(shell, self.session, MESSAGES)
        self.assertIs(shell.find_cell_magic("tsql"), original)

    def test_broker_rejects_non_loopback_url(self):
        for url in ("https://example.com", "http://localhost:1234",
                    "http://127.0.0.1:1234/path", "http://user@127.0.0.1:1234"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                notebook.BrokerClient(url, "capability", MESSAGES)

    def test_token_provider_checks_scope(self):
        client = SimpleNamespace(request=Mock(return_value={"token": "token", "expiresOn": 9999999999}))
        provider = notebook.NotebookTokenProvider(client, MESSAGES)
        with self.assertRaisesRegex(ValueError, "scope"):
            provider.get_token("https://management.azure.com/.default")
        client.request.assert_not_called()
        self.assertEqual(provider.get_token("https://database.windows.net/.default").token, "token")

    def test_initialize_maps_driver_keywords_and_closes_on_registration_failure(self):
        shell = InteractiveShell()
        configuration = {
            "settings": {
                "server": "localhost,1433", "database": "selected-db",
                "encrypt": "yes", "trustServerCertificate": False,
                "loginTimeout": 15, "queryTimeout": 30, "multiSubnetFailover": True,
                "applicationName": "vscode-mssql",
            },
            "authentication": {
                "kind": "sql", "username": "user", "password": "synthetic-secret",
            },
        }
        with patch.object(notebook, "get_ipython", return_value=shell), \
                patch.object(notebook.BrokerClient, "request", return_value=configuration), \
                patch.object(notebook.mssql_python, "connect", create=True,
                             return_value=self.connection) as connect, \
                patch.object(notebook, "register_magic", side_effect=RuntimeError("conflict")):
            with self.assertRaisesRegex(RuntimeError, "conflict"):
                notebook.initialize("http://127.0.0.1:1234", "test-capability", MESSAGES)
        self.assertEqual(connect.call_args.kwargs["trustservercertificate"], "no")
        self.assertEqual(connect.call_args.kwargs["multisubnetfailover"], "yes")
        self.assertEqual(connect.call_args.kwargs["database"], "selected-db")
        self.assertTrue(connect.call_args.kwargs["autocommit"])
        self.connection.close.assert_called_once()

    def test_initialize_omits_unspecified_database_so_the_login_default_is_used(self):
        for database in (None, "", "missing"):
            with self.subTest(database=database):
                configuration = {
                    "settings": {
                        "server": "synthetic-server", "encrypt": "yes",
                        "trustServerCertificate": False, "loginTimeout": 15, "queryTimeout": 30,
                    },
                    "authentication": {
                        "kind": "sql", "username": "user", "password": "synthetic-secret",
                    },
                }
                if database != "missing":
                    configuration["settings"]["database"] = database
                shell = InteractiveShell()
                with patch.object(notebook, "get_ipython", return_value=shell), \
                        patch.object(notebook.BrokerClient, "request", return_value=configuration), \
                        patch.object(notebook.mssql_python, "connect", create=True,
                                     return_value=self.connection) as connect:
                    session = notebook.initialize("http://127.0.0.1:1234", "test-only", MESSAGES)
                self.assertNotIn("database", connect.call_args.kwargs)
                session.close()

    def test_broker_http_contract_rejects_redirects_and_oversized_responses(self):
        received = []
        response = {"status": 200, "body": json.dumps({"token": "synthetic-token"}).encode()}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((
                    self.path, self.headers["Authorization"], self.rfile.read(2),
                ))
                self.send_response(response["status"])
                if response["status"] == 302:
                    self.send_header("Location", "/redirect-target")
                self.send_header("Content-Length", str(len(response["body"])))
                self.end_headers()
                self.wfile.write(response["body"])

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                client = notebook.BrokerClient(
                    f"http://127.0.0.1:{server.server_port}", "test-capability", MESSAGES,
                )
                with patch.dict("os.environ", {"HTTP_PROXY": "http://127.0.0.1:1"}):
                    self.assertEqual(client.request("/v1/token"), {"token": "synthetic-token"})
                response["status"] = 302
                with self.assertRaisesRegex(RuntimeError, "^brokerFailed$"):
                    client.request("/v1/token")
                response.update(status=200, body=b" " * 65_537)
                with self.assertRaisesRegex(RuntimeError, "^brokerFailed$"):
                    client.request("/v1/configuration")
                self.assertEqual(received, [
                    ("/v1/token", "Bearer test-capability", b"{}"),
                    ("/v1/token", "Bearer test-capability", b"{}"),
                    ("/v1/configuration", "Bearer test-capability", b"{}"),
                ])
            finally:
                server.shutdown()
                thread.join(timeout=5)
                self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
