# Spec-Kit Developer Guide

This guide explains how to use spec-kit to create, plan, and implement feature specifications in this repository.

## What is Spec-Kit?

Spec-kit is a specification-driven development framework that helps you:

1. **Define** clear feature specifications from natural language descriptions
2. **Plan** technical implementations with research and design artifacts
3. **Break down** work into actionable, dependency-ordered tasks
4. **Implement** features systematically following the generated plan
5. **Validate** consistency across specifications, plans, and tasks

## Support for differnet tools

Spec-kit agents are defined in `.github/agents/speckit.*.agent.md` and can be invoked:


1. **VS Code Chat**: Use the same slash commands in Copilot Chat. For example, type `/speckit.specify` in the chat input to create a new specification.
1. **Claude Code CLI**: Type `/speckit.specify`, `/speckit.plan`, etc. The commands are redirected to the appropriate agent in `.github/agents/` folder.
1. **Codex CLI**: Use `@.github/agents/speckit.<command>.agent.md` to invoke specific commands. Note: Codex CLI does not support slash commands you must use '@' syntax.
1. **GitHub Copilot**: Agents work in GitHub's web interface


## Quick Start

```bash
# 1. Create a new feature specification
/speckit.specify Feature description goes here

# 2. (Optional) Clarify any ambiguous requirements
/speckit.clarify

# 3. Create a technical plan
/speckit.plan

# 4. Generate implementation tasks
/speckit.tasks

# 5. (Optional) Analyze for consistency
/speckit.analyze

# 6. Implement the feature
/speckit.implement
```

## Configuration: config.json

The `.specify/config.json` file customizes spec-kit behavior for your project. Copy from the template and customize:

```bash
cp .specify/config.template.json .specify/config.json
```

### Configuration Options

```json
{
  "branchPrefix": "<your-name>/"
}
```

| Option | Description | Fallback | Example |
|--------|-------------|---------|---------|
| `branchPrefix` | Prefix added to all feature branch names | your git username | `<your-name>/123-feature-name` |

**Note**: `config.json` is gitignored to allow personal configuration without affecting the repository.


## Best Practices

### 1. Start with Clear Descriptions

The better your initial description, the better the specification:

```bash
# Good: Specific with context
/speckit.specify Add a connection history panel that shows the last 10 database
connections with server name, database, and timestamp. Users should be able to
click to reconnect or remove entries.

# Avoid: Too vague
/speckit.specify Add connection history
```

### 2. Use Clarify for Ambiguities. DO NOT skip this step.

For features with multiple user types, integrations, or edge cases:

```bash
/speckit.specify Add multi-tenant support for database connections
/speckit.clarify  # Resolve ambiguities about tenant isolation, sharing, etc.
```

### 3. Provide Technical Context to Plan

Help the planner understand your constraints. You may specify tech stack, libraries (eg: Slickgrid React, Reactflows, etc), or existing patterns to follow:

```bash
/speckit.plan Building with Fluent UI flat tree compoents and use tanstack virtualized for performance.
```

### 4. Review Tasks Before Implementation

Check that tasks cover all user stories and have correct dependencies:

```bash
/speckit.tasks
# Review tasks.md
/speckit.analyze  # Optional: automated consistency check
```

### 5. Use Checklists for Quality Gates

Create domain-specific checklists before implementation:

```bash
/speckit.checklist security review for authentication flow
/speckit.checklist accessibility requirements for new UI components
```

## Constitution Compliance

All specifications must comply with the project constitution at `.specify/memory/constitution.md`.
