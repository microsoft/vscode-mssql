-- Purpose: Demonstrates ALTER LOGIN with MUST_CHANGE password policy behavior.
-- Tags: sqlserver, login, password-policy, security-fixture
-- Replace the placeholder password before running in a disposable test environment.

ALTER LOGIN [tempChange]
WITH PASSWORD = '<temporary-password>' MUST_CHANGE;
