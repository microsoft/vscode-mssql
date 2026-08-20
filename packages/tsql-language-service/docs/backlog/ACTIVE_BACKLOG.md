# Active language-service backlog

This file lists known product gaps, not completed milestones or agent work logs. A checked item must
link to executable evidence before removal.

## Syntax and recovery

- [ ] Reduce remaining conformance-corpus recovery per fixture without increasing any other fixture.
- [ ] Add focused positive, negative, incomplete-typing, and incremental/fresh tests for every new
      grammar construct.
- [ ] Continue compatibility-level and engine-profile coverage for uncommon administrative syntax.

## Semantics and diagnostics

- [ ] Extend authoritative catalog semantics for uncommon security, administration, external, and
      specialized index objects as provider metadata becomes available.

## Language features

- [ ] Expand contextual completion for uncommon DDL, security, administration, and platform forms.
- [ ] Add richer hover/signature documentation for specialized metadata and callable forms.
- [ ] Add catalog-wide references/rename only when a backend can provide authoritative identities.
- [ ] Broaden scripted definition support and report backend limitations explicitly.

## Host and operations

- [ ] Evaluate the worker transport in the preview extension after lifecycle/heartbeat measurements.
- [ ] Run large-catalog and long-session soak tests across supported connection profiles.
- [ ] Keep formatting and inlay hints out of the public contract until separately designed and tested.

Audit-remediation tasks remain in
[`LANGUAGE_SERVICE_AUDIT_REMEDIATION_PLAN.md`](../analysis/LANGUAGE_SERVICE_AUDIT_REMEDIATION_PLAN.md)
until that plan is complete.
