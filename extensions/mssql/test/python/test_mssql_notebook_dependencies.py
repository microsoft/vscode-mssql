# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


runtime = Path(__file__).resolve().parents[2] / "python"
spec = importlib.util.spec_from_file_location(
    "mssql_notebook_dependencies", runtime / "mssql_notebook_dependencies.py"
)
dependencies = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dependencies)
requirements = (runtime / "requirements.txt").read_text()


class DependencyTests(unittest.TestCase):
    def setUp(self):
        self.versions = {"mssql-python": "1.16.0", "pandas": "2.2.3", "ipython": "8.37.0"}
        self.metadata = patch.object(
            dependencies.metadata, "version", side_effect=self.versions.__getitem__
        )
        self.metadata.start()
        self.addCleanup(self.metadata.stop)
        modules = patch.dict("sys.modules", {
            "mssql_python": SimpleNamespace(__version__="1.16.0"),
            "pandas": SimpleNamespace(__version__="2.2.3"),
            "IPython": SimpleNamespace(__version__="8.37.0"),
        })
        modules.start()
        self.addCleanup(modules.stop)

    def test_supported_installed_and_loaded_packages_are_ready(self):
        with patch.dict("sys.modules", {"pandas": SimpleNamespace(__version__="2.2.3")}):
            self.assertEqual(dependencies.check_dependencies(requirements), "ready")

    def test_replaced_package_metadata_does_not_approve_the_loaded_old_module(self):
        with patch.dict("sys.modules", {"pandas": SimpleNamespace(__version__="3.0.0")}):
            self.assertEqual(dependencies.check_dependencies(requirements), "restart")

    def test_unknown_loaded_version_requires_restart(self):
        with patch.dict("sys.modules", {"mssql_python": SimpleNamespace()}):
            self.assertEqual(dependencies.check_dependencies(requirements), "restart")

    def test_deferred_restart_still_blocks_later_checks_when_direct_versions_match(self):
        with patch.object(
            dependencies.sys, "_vscode_mssql_restart_required", True, create=True,
        ):
            self.assertEqual(dependencies.check_dependencies(requirements), "restart")
            self.assertEqual(dependencies.check_dependencies(requirements), "restart")

    def test_unsupported_installed_package_requires_installation(self):
        self.versions["pandas"] = "3.0.0"
        self.assertEqual(dependencies.check_dependencies(requirements), "missing")

    def test_prerelease_is_not_approved_as_a_supported_stable_version(self):
        self.versions["pandas"] = "2.2.0rc1"
        self.assertEqual(dependencies.check_dependencies(requirements), "missing")

    def test_missing_package_requires_installation(self):
        self.metadata.stop()
        with patch.object(
            dependencies.metadata, "version",
            side_effect=dependencies.metadata.PackageNotFoundError,
        ):
            self.assertEqual(dependencies.check_dependencies(requirements), "missing")

    def test_unsupported_python_does_not_attempt_to_read_package_metadata(self):
        with patch.object(dependencies.sys, "version_info", (3, 9)):
            self.assertEqual(dependencies.check_dependencies(requirements), "missing")
        dependencies.metadata.version.assert_not_called()


if __name__ == "__main__":
    unittest.main()
