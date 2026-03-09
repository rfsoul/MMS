# ARCHITECTURE.md

## System Architecture Overview

MMS is a multi‑tenant Maintenance Management System with web and mobile
clients communicating through a shared REST API.

------------------------------------------------------------------------

# High‑Level Architecture

Clients:

-   Web Admin Interface (React + Vite)
-   Mobile Technician App (React Native / Expo)

Both communicate with a central backend API.

System structure:

Clients → REST API → Database

------------------------------------------------------------------------

# Backend API Layer

The backend is built using Node.js and Express.

Core components include:

-   Authentication
-   Companies and Users
-   Asset Graph
-   Work Orders
-   Checklists
-   Preventive Maintenance
-   Issue Reporting

Each request flows through:

HTTP Route → Service Layer → Database Query

------------------------------------------------------------------------

# Deployment Architecture

Typical container deployment:

NGINX (web host) ↓ Node.js API Server ↓ PostgreSQL Database

PostgreSQL includes extensions:

-   Apache AGE for graph storage
-   PostGIS for spatial data

------------------------------------------------------------------------

# Asset Graph Architecture

Assets are represented as a graph hierarchy.

Example structure:

Site ├ Building │ ├ Floor │ │ ├ Space │ │ │ ├ System │ │ │ │ ├ Asset │ │
│ │ │ └ Component

Graph relationships represent containment and dependency.

Example:

Chiller FEEDS Air Handling Unit

This allows impact analysis across systems.

------------------------------------------------------------------------

# Operational Data Model

Relational tables manage operational records.

Example:

Work Orders ├ Tasks │ └ Checklist Responses ├ Updates └ Photos

Typical lifecycle:

open → assigned → in_progress → completed

------------------------------------------------------------------------

# Issue Management Workflow

Issues originate from reporters or help desk.

Workflow:

Issue → Inspection → Work Orders → Resolution

Lifecycle:

open → assigned → inspecting → follow_up_work → closed

Database triggers enforce lifecycle rules.

------------------------------------------------------------------------

# Preventive Maintenance

PM schedules automatically generate work orders.

Schedule types:

-   time based
-   runtime based

Work orders are generated in advance to support planning.

------------------------------------------------------------------------

# Checklist System

Checklists capture inspection and maintenance measurements.

Structure:

Template → Asset Checklist → Responses

Responses may generate engineering data used for long‑term asset
analysis.

------------------------------------------------------------------------

# Mobile Architecture

Technicians operate using a mobile application with offline capability.

Device flow:

Mobile Device ↓ Local SQLite Cache ↓ Sync with API

This allows work orders to be completed without connectivity.

------------------------------------------------------------------------

# Background Services

The backend includes background processes:

-   PM Scheduler
-   Session cleanup
-   Token expiration
-   Future graph analytics
