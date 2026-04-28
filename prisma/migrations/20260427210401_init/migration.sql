-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hcmEmployeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hcmLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "availableDays" REAL NOT NULL,
    "pendingDays" REAL NOT NULL,
    "hcmSyncedAt" DATETIME NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BalanceSnapshot_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BalanceSnapshot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeOffRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "daysRequested" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "hcmSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimeOffRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TimeOffRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "prevStatus" TEXT,
    "newStatus" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "AuditEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TimeOffRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_hcmEmployeeId_key" ON "Employee"("hcmEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Location_hcmLocationId_key" ON "Location"("hcmLocationId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_employeeId_locationId_idx" ON "BalanceSnapshot"("employeeId", "locationId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_hcmSyncedAt_idx" ON "BalanceSnapshot"("hcmSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceSnapshot_employeeId_locationId_key" ON "BalanceSnapshot"("employeeId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeOffRequest_idempotencyKey_key" ON "TimeOffRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TimeOffRequest_employeeId_createdAt_idx" ON "TimeOffRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "TimeOffRequest_employeeId_status_idx" ON "TimeOffRequest"("employeeId", "status");

-- CreateIndex
CREATE INDEX "TimeOffRequest_locationId_startDate_idx" ON "TimeOffRequest"("locationId", "startDate");

-- CreateIndex
CREATE INDEX "AuditEvent_requestId_timestamp_idx" ON "AuditEvent"("requestId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_actorId_timestamp_idx" ON "AuditEvent"("actorId", "timestamp");

-- CreateIndex
CREATE INDEX "SyncJob_type_startedAt_idx" ON "SyncJob"("type", "startedAt");
