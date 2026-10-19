# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

import importlib.metadata as metadata
import operator
import re
import sys


def _version(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d+)*", value):
        return None
    parts = tuple(int(part) for part in value.split("."))
    return parts + (0,) * max(0, 3 - len(parts))


def check_dependencies(requirements):
    if sys.version_info < (3, 10):
        return "missing"
    if getattr(sys, "_vscode_mssql_restart_required", False):
        return "restart"
    restart = False
    comparisons = {"==": operator.eq, ">=": operator.ge, "<": operator.lt}
    modules = {"mssql-python": "mssql_python", "pandas": "pandas", "ipython": "IPython"}
    for line in requirements.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([\w-]+)((?:==|>=|<).+)", line)
        if not match or match[1] not in modules:
            raise ValueError("Invalid notebook dependency requirement")
        name, constraints = match.groups()
        try:
            installed = _version(metadata.version(name))
        except metadata.PackageNotFoundError:
            return "missing"
        if installed is None:
            return "missing"
        for constraint in constraints.split(","):
            match = re.fullmatch(r"(==|>=|<)(\d+(?:\.\d+)*)", constraint)
            if not match:
                raise ValueError("Invalid notebook dependency constraint")
            if not comparisons[match[1]](installed, _version(match[2])):
                return "missing"
        loaded = sys.modules.get(modules[name])
        if loaded is not None and _version(getattr(loaded, "__version__", None)) != installed:
            restart = True
    return "restart" if restart else "ready"
