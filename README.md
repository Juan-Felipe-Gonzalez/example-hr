# Author: 

Juan Felipe González

![Tests](https://img.shields.io/badge/tests-52%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-66%25-yellow)
![NestJS](https://img.shields.io/badge/NestJS-v10-red)
![License](https://img.shields.io/badge/license-MIT-blue)

## Description

Time-Off Microservice built with NestJS and SQLite to manage employee leave requests while keeping balances synchronized with external HCM systems such as Workday or SAP. Includes request lifecycle management, balance validation, real-time and batch sync flows, defensive consistency checks, automated tests, and mock HCM integrations.

## Test Coverage

The test suite comprises 52 tests across 8 suites, covering unit, integration, and E2E scenarios as defined in the TRD. All suites pass cleanly in 7.5 seconds.

![test Coverage image](./documnetation/testCoverage.jpg)

Core business logic is well-covered: app.module, balances.controller, idempotency.service, and prisma.module all reach 100% line coverage. The reconciler.service hits 92% lines and requests.service 69.5%, with uncovered branches concentrated in edge-case error paths and retry logic that require a live HCM connection to exercise fully. The src/guards folder sits at lower coverage due to auth flows that depend on JWT context not wired in the current mock setup — these are tracked and earmarked for the next iteration.

## How to setup the project

```bash
$ npm install
```

## Documentation
- [Technical Requirements Document (TRD)](./documentation/TRD.docx)

## How to compile and run the project

```bash
# development
$ npm run start

# prisma database
$ npx prisma studio
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```


## Technologies

This project is built using the following technologies:

- **Node.js**: JavaScript runtime for server-side development
- **NestJS**: A progressive Node.js framework for building efficient, reliable and scalable server-side applications
- **TypeScript**: A typed superset of JavaScript that compiles to plain JavaScript
- **Prisma**: Next-generation ORM for Node.js & TypeScript
- **Express**: Fast, unopinionated, minimalist web framework for Node.js
- **Jest**: A delightful JavaScript Testing Framework with a focus on simplicity
- **ESLint**: A tool for identifying and reporting on patterns in ECMAScript/JavaScript code
- **Prettier**: An opinionated code formatter

## API Endpoints

The application provides the following REST API endpoints:

### Balances

- `GET /balances/:employeeId` - Retrieves all location balances for an employee
- `GET /balances/:employeeId/:locationId` - Retrieves a single location balance for an employee
- `POST /balances/batch-sync` - Initiates a manual batch reconciliation job (Admin only)

### Requests

- `POST /requests` - Creates a new time-off request (Employee only, requires Idempotency-Key header)
- `GET /requests/:id` - Retrieves a single time-off request
- `GET /requests` - Lists time-off requests with optional filtering (Manager/Admin only)
- `PATCH /requests/:id/approve` - Approves a time-off request (Manager/Admin only)
- `PATCH /requests/:id/reject` - Rejects a time-off request (Manager/Admin only)
- `DELETE /requests/:id` - Cancels a time-off request (Employee or Admin)

### AI Agents

* Documentation: Claude Code
* REST API: Cursor
* Tests: Copilot & Codex
* Moral support: Chatgpt
