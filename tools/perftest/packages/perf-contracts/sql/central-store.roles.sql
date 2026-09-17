/* ============================================================================
   Central observability store — database roles and grants (central design
   §10.1, review addendum H-5, Appendix C).

   Least privilege, structurally enforced:
   - central_writer executes the ingestion procs and NOTHING else — no table
     INSERT/UPDATE/SELECT on base tables.
   - central_ci = writer + baseline/purge/retention procs.
   - central_reader / central_grafana read views only, never base tables
     (which also guarantees readers can't bypass the C-3 visibility join).
   - central_admin manages schema/migrations (dbo-level operations are still
     the DBA's, this role covers routine admin procs).
   ============================================================================ */

IF DATABASE_PRINCIPAL_ID(N'central_reader') IS NULL CREATE ROLE central_reader;
IF DATABASE_PRINCIPAL_ID(N'central_writer') IS NULL CREATE ROLE central_writer;
IF DATABASE_PRINCIPAL_ID(N'central_ci') IS NULL CREATE ROLE central_ci;
IF DATABASE_PRINCIPAL_ID(N'central_admin') IS NULL CREATE ROLE central_admin;
IF DATABASE_PRINCIPAL_ID(N'central_grafana') IS NULL CREATE ROLE central_grafana;
GO

/* Writer: ingestion procs only (Appendix C list, minus admin lanes). */
GRANT EXECUTE ON OBJECT::central.usp_begin_upload TO central_writer;
GRANT EXECUTE ON OBJECT::central.usp_stage_upload_item TO central_writer;
GRANT EXECUTE ON OBJECT::central.usp_commit_upload TO central_writer;
GRANT EXECUTE ON OBJECT::central.usp_abort_upload TO central_writer;
GRANT EXECUTE ON OBJECT::central.usp_store_health TO central_writer;
GO

/* CI: writer + role-gated lanes. */
ALTER ROLE central_writer ADD MEMBER central_ci;
GRANT EXECUTE ON OBJECT::central.usp_set_baseline TO central_ci;
GRANT EXECUTE ON OBJECT::central.usp_retention_cleanup TO central_ci;
GO

/* Admin: everything the CI can do plus purge. */
ALTER ROLE central_ci ADD MEMBER central_admin;
GRANT EXECUTE ON OBJECT::central.usp_purge_entity TO central_admin;
GO

/* Readers: views only. */
GRANT SELECT ON OBJECT::central.visible_batches TO central_reader;
GRANT SELECT ON OBJECT::central.official_metric_samples TO central_reader;
GRANT SELECT ON OBJECT::central.official_metric_samples_ex TO central_reader;
GRANT SELECT ON OBJECT::central.latest_run_per_scenario_env TO central_reader;
GRANT SELECT ON OBJECT::central.trend TO central_reader;
GRANT SELECT ON OBJECT::central.regressions_last_30d TO central_reader;
GRANT SELECT ON OBJECT::central.sessions_by_feature_error_rate TO central_reader;
GRANT SELECT ON OBJECT::central.sessions_by_build TO central_reader;
GRANT SELECT ON OBJECT::central.fleet_by_build TO central_reader;
GRANT SELECT ON OBJECT::central.upload_history TO central_reader;
GRANT SELECT ON OBJECT::central.policy_drop_summary TO central_reader;
GRANT SELECT ON OBJECT::central.ingestion_failures TO central_reader;
GRANT SELECT ON OBJECT::central.central_health TO central_reader;
GRANT EXECUTE ON OBJECT::central.usp_store_health TO central_reader;
GO

/* Grafana: dashboard views only (no ledger digests, no ingestion detail). */
GRANT SELECT ON OBJECT::central.official_metric_samples TO central_grafana;
GRANT SELECT ON OBJECT::central.official_metric_samples_ex TO central_grafana;
GRANT SELECT ON OBJECT::central.latest_run_per_scenario_env TO central_grafana;
GRANT SELECT ON OBJECT::central.trend TO central_grafana;
GRANT SELECT ON OBJECT::central.regressions_last_30d TO central_grafana;
GRANT SELECT ON OBJECT::central.sessions_by_feature_error_rate TO central_grafana;
GRANT SELECT ON OBJECT::central.sessions_by_build TO central_grafana;
GRANT SELECT ON OBJECT::central.fleet_by_build TO central_grafana;
GRANT SELECT ON OBJECT::central.central_health TO central_grafana;
GO
