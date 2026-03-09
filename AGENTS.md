# AGENTS.md

## Purpose

This document instructs AI coding agents (Codex or similar) how to
safely work within the MMS repository.\
Agents must follow the architectural and coding conventions described
here.

------------------------------------------------------------------------

# System Overview

MMS is a **multi‑tenant Maintenance Management System (CMMS)**.

Technology stack:

-   Backend: Node.js + Express
-   Database: PostgreSQL
-   Extensions: Apache AGE (graph), PostGIS
-   Web UI: React + Vite
-   Mobile: React Native / Expo

Relational data is stored in PostgreSQL tables while **asset topology is
stored in Apache AGE graph structures**.

The linking key between relational data and graph nodes is:

asset_graph_id

This stores the AGE node id as TEXT.

------------------------------------------------------------------------

# Multi‑Tenancy Rules

All companies share the same database.

Most tables include:

company_id

Services must enforce:

WHERE company_id = requestingUser.company_id

Exception:

help_desk_agent role may access multiple companies.

Never expose cross‑tenant data to unauthorized users.

------------------------------------------------------------------------

# Backend Architecture

The backend follows this structure:

routes → services → database

### Routes

Location:

api/src/routes

Responsibilities:

-   HTTP request parsing
-   authentication middleware
-   calling services
-   returning JSON responses

Routes must **not contain business logic**.

------------------------------------------------------------------------

### Services

Location:

api/src/services

Responsibilities:

-   business logic
-   validation
-   database queries
-   enforcing tenant boundaries
-   throwing structured errors

All domain rules belong here.

------------------------------------------------------------------------

### Database Access

Database pool wrapper:

api/src/db/pool.js

Use parameterized queries only.

Example:

SELECT \* FROM work_orders WHERE id = \$1

Never interpolate SQL variables.

------------------------------------------------------------------------

# Error Handling

Use the shared fail() helper pattern:

fail(status, code, message)

Example:

fail(404,'NOT_FOUND','Work order not found')

Services throw errors which are formatted by Express middleware.

Standard error response:

{ "code": "ERROR_CODE", "message": "Human readable message" }

------------------------------------------------------------------------

# Authentication

Authentication uses JWT.

Login endpoint:

POST /auth/login

Returns:

{ token, user }

Protected routes require middleware such as:

requireAuth requireRole(...) requireCompanyUser

------------------------------------------------------------------------

# Database Trigger Behaviour

Business rules are enforced in the database using triggers.

Examples:

-   issue lifecycle timestamps
-   checklist completion validation
-   automatic issue closing

Triggers may read:

current_setting('app.current_user_id')

Services must set this value before executing SQL that fires triggers.

------------------------------------------------------------------------

# Asset Graph Model

Assets are stored in Apache AGE.

Hierarchy:

Site → Building → Floor → Space → System → Asset → Component

Common relationships:

CONTAINS HAS_ASSET PART_OF HAS_COMPONENT FEEDS

Relational tables reference graph nodes using:

asset_graph_id

------------------------------------------------------------------------

# Work Order Lifecycle

Typical status progression:

open → assigned → in_progress → on_hold → completed

Tasks belong to work orders and may require checklist completion.

------------------------------------------------------------------------

# Checklist Model

Three levels:

Template → Asset Checklist → Checklist Responses

Templates are immutable once assigned.

When attached to a work order, checklist items are copied into
work‑order tables.

------------------------------------------------------------------------

# Preventive Maintenance

PM schedules generate work orders automatically.

Scheduler endpoint:

POST /pm/run

Schedules support:

-   calendar triggers
-   runtime triggers

Generated work orders recorded in:

pm_generated_work_orders

------------------------------------------------------------------------

# Testing

Automated test harness located in:

test/test-harness.js

All new endpoints must include tests.

------------------------------------------------------------------------

# Seed Data

Database seed scripts located in:

db/seed

Typical order:

00_teardown.sql 01_setup.sql 02_seed_companies_users.sql
03_seed_graph.sql 04_seed_checklists 05_seed_pm_schedules.sql
06_seed_work_orders.sql 07_seed_issues.sql 08_seed_lisa_workorders.sql

Agents modifying schema must update seeds accordingly.

------------------------------------------------------------------------

# Coding Rules

Agents must:

-   enforce tenant isolation
-   use parameterized SQL
-   keep routes thin
-   place domain logic in services
-   mirror existing patterns

When uncertain, follow existing implementations.
