# Juan Felipe González

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

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

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod

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

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

