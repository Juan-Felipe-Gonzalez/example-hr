# Author: 

Juan Felipe González

## Description

Time-Off Microservice built with NestJS and SQLite to manage employee leave requests while keeping balances synchronized with external HCM systems such as Workday or SAP. Includes request lifecycle management, balance validation, real-time and batch sync flows, defensive consistency checks, automated tests, and mock HCM integrations.

## How to setup the project

```bash
$ npm install
```

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

Documentation:
* Claude Code

REST API:
* Cursor

Tests: 
* Copilot
* Codex

