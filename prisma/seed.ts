import {
  PrismaClient,
  Prisma,
  TimeOffRequestStatus,
  SyncJobType,
  SyncJobStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function uuid(prefix: string, n: number) {
  return `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const LOCATIONS = [
  {
    id: uuid('loc', 1),
    hcmLocationId: 'HCM-LOC-001',
    name: 'New York HQ',
    region: 'US-EAST',
  },
  {
    id: uuid('loc', 2),
    hcmLocationId: 'HCM-LOC-002',
    name: 'San Francisco',
    region: 'US-WEST',
  },
  {
    id: uuid('loc', 3),
    hcmLocationId: 'HCM-LOC-003',
    name: 'London Office',
    region: 'EU-WEST',
  },
];

const EMPLOYEES = [
  {
    id: uuid('emp', 1),
    hcmEmployeeId: 'HCM-EMP-001',
    name: 'Alice Martin',
    email: 'alice@example.com',
  },
  {
    id: uuid('emp', 2),
    hcmEmployeeId: 'HCM-EMP-002',
    name: 'Bob Chen',
    email: 'bob@example.com',
  },
  {
    id: uuid('emp', 3),
    hcmEmployeeId: 'HCM-EMP-003',
    name: 'Carol Davis',
    email: 'carol@example.com',
  },
  {
    id: uuid('emp', 4),
    hcmEmployeeId: 'HCM-EMP-004',
    name: 'David Kim',
    email: 'david@example.com',
  },
  {
    id: uuid('emp', 5),
    hcmEmployeeId: 'HCM-EMP-005',
    name: 'Eva Rossi',
    email: 'eva@example.com',
  },
  {
    id: uuid('emp', 6),
    hcmEmployeeId: 'HCM-EMP-006',
    name: 'Frank Torres',
    email: 'frank@example.com',
  },
  {
    id: uuid('emp', 7),
    hcmEmployeeId: 'HCM-EMP-007',
    name: 'Grace Liu',
    email: 'grace@example.com',
  },
  {
    id: uuid('emp', 8),
    hcmEmployeeId: 'HCM-EMP-008',
    name: 'Henry Müller',
    email: 'henry@example.com',
  },
  {
    id: uuid('emp', 9),
    hcmEmployeeId: 'HCM-EMP-009',
    name: 'Isla Patel',
    email: 'isla@example.com',
  },
  {
    id: uuid('emp', 10),
    hcmEmployeeId: 'HCM-EMP-010',
    name: "James O'Brien",
    email: 'james@example.com',
  },
  {
    id: uuid('emp', 11),
    hcmEmployeeId: 'HCM-EMP-011',
    name: 'Karen Nakamura',
    email: 'karen@example.com',
  },
  {
    id: uuid('emp', 12),
    hcmEmployeeId: 'HCM-EMP-012',
    name: 'Liam Dupont',
    email: 'liam@example.com',
  },
];

// Each employee gets a snapshot per location they belong to
// For simplicity: emps 1-4 → NYC, 5-8 → SF, 9-12 → London
const EMPLOYEE_LOCATION_MAP: Record<number, number> = {
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 2,
  6: 2,
  7: 2,
  8: 2,
  9: 3,
  10: 3,
  11: 3,
  12: 3,
};

// ─── Time-off requests with varied statuses ──────────────────────────────────
// Covers: DRAFT, SUBMITTED, APPROVED, REJECTED, CANCELLED
// Some are hcmSubmitted, some pending

interface RequestSeed {
  id: string;
  empIdx: number; // 1-based index into EMPLOYEES
  locIdx: number; // 1-based index into LOCATIONS
  startOffset: number;
  endOffset: number;
  daysRequested: number;
  status: TimeOffRequestStatus;
  hcmSubmitted: boolean;
  idempotencyKey: string;
  createdDaysAgo: number;
}

const REQUESTS: RequestSeed[] = [
  // Alice — approved + hcm submitted
  {
    id: uuid('req', 1),
    empIdx: 1,
    locIdx: 1,
    startOffset: 10,
    endOffset: 14,
    daysRequested: 5,
    status: 'APPROVED',
    hcmSubmitted: true,
    idempotencyKey: 'idem-001',
    createdDaysAgo: 20,
  },
  // Bob — submitted, awaiting approval
  {
    id: uuid('req', 2),
    empIdx: 2,
    locIdx: 1,
    startOffset: 20,
    endOffset: 22,
    daysRequested: 3,
    status: 'SUBMITTED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-002',
    createdDaysAgo: 5,
  },
  // Carol — draft, not yet submitted
  {
    id: uuid('req', 3),
    empIdx: 3,
    locIdx: 1,
    startOffset: 30,
    endOffset: 31,
    daysRequested: 2,
    status: 'DRAFT',
    hcmSubmitted: false,
    idempotencyKey: 'idem-003',
    createdDaysAgo: 2,
  },
  // David — rejected
  {
    id: uuid('req', 4),
    empIdx: 4,
    locIdx: 1,
    startOffset: -10,
    endOffset: -8,
    daysRequested: 3,
    status: 'REJECTED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-004',
    createdDaysAgo: 15,
  },
  // Eva — cancelled
  {
    id: uuid('req', 5),
    empIdx: 5,
    locIdx: 2,
    startOffset: 5,
    endOffset: 9,
    daysRequested: 5,
    status: 'CANCELLED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-005',
    createdDaysAgo: 8,
  },
  // Frank — approved + hcm submitted
  {
    id: uuid('req', 6),
    empIdx: 6,
    locIdx: 2,
    startOffset: 15,
    endOffset: 19,
    daysRequested: 5,
    status: 'APPROVED',
    hcmSubmitted: true,
    idempotencyKey: 'idem-006',
    createdDaysAgo: 12,
  },
  // Grace — submitted
  {
    id: uuid('req', 7),
    empIdx: 7,
    locIdx: 2,
    startOffset: 3,
    endOffset: 3,
    daysRequested: 1,
    status: 'SUBMITTED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-007',
    createdDaysAgo: 1,
  },
  // Henry — approved but NOT yet hcm submitted (edge case)
  {
    id: uuid('req', 8),
    empIdx: 8,
    locIdx: 2,
    startOffset: 25,
    endOffset: 29,
    daysRequested: 5,
    status: 'APPROVED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-008',
    createdDaysAgo: 3,
  },
  // Isla — draft
  {
    id: uuid('req', 9),
    empIdx: 9,
    locIdx: 3,
    startOffset: 40,
    endOffset: 44,
    daysRequested: 5,
    status: 'DRAFT',
    hcmSubmitted: false,
    idempotencyKey: 'idem-009',
    createdDaysAgo: 1,
  },
  // James — rejected (overlap test scenario)
  {
    id: uuid('req', 10),
    empIdx: 10,
    locIdx: 3,
    startOffset: -5,
    endOffset: -3,
    daysRequested: 3,
    status: 'REJECTED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-010',
    createdDaysAgo: 10,
  },
  // Karen — approved, partial day (0.5)
  {
    id: uuid('req', 11),
    empIdx: 11,
    locIdx: 3,
    startOffset: 7,
    endOffset: 7,
    daysRequested: 0.5,
    status: 'APPROVED',
    hcmSubmitted: true,
    idempotencyKey: 'idem-011',
    createdDaysAgo: 4,
  },
  // Liam — submitted
  {
    id: uuid('req', 12),
    empIdx: 12,
    locIdx: 3,
    startOffset: 12,
    endOffset: 16,
    daysRequested: 5,
    status: 'SUBMITTED',
    hcmSubmitted: false,
    idempotencyKey: 'idem-012',
    createdDaysAgo: 2,
  },
];

// ─── Audit events per request ────────────────────────────────────────────────
// Actor is always the request owner (self-service flow)

interface AuditSeed {
  id: string;
  requestIdx: number;
  actorEmpIdx: number;
  action: string;
  prevStatus: TimeOffRequestStatus | null;
  newStatus: TimeOffRequestStatus | null;
  daysAgoTs: number;
  metadata?: object;
}

const AUDIT_EVENTS: AuditSeed[] = [
  // req-1 Alice: DRAFT → SUBMITTED → APPROVED
  {
    id: uuid('aud', 1),
    requestIdx: 1,
    actorEmpIdx: 1,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 20,
  },
  {
    id: uuid('aud', 2),
    requestIdx: 1,
    actorEmpIdx: 1,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 19,
  },
  {
    id: uuid('aud', 3),
    requestIdx: 1,
    actorEmpIdx: 1,
    action: 'APPROVE',
    prevStatus: 'SUBMITTED',
    newStatus: 'APPROVED',
    daysAgoTs: 18,
  },
  // req-2 Bob: DRAFT → SUBMITTED
  {
    id: uuid('aud', 4),
    requestIdx: 2,
    actorEmpIdx: 2,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 5,
  },
  {
    id: uuid('aud', 5),
    requestIdx: 2,
    actorEmpIdx: 2,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 4,
  },
  // req-3 Carol: DRAFT only
  {
    id: uuid('aud', 6),
    requestIdx: 3,
    actorEmpIdx: 3,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 2,
  },
  // req-4 David: DRAFT → SUBMITTED → REJECTED
  {
    id: uuid('aud', 7),
    requestIdx: 4,
    actorEmpIdx: 4,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 15,
  },
  {
    id: uuid('aud', 8),
    requestIdx: 4,
    actorEmpIdx: 4,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 14,
  },
  {
    id: uuid('aud', 9),
    requestIdx: 4,
    actorEmpIdx: 4,
    action: 'REJECT',
    prevStatus: 'SUBMITTED',
    newStatus: 'REJECTED',
    daysAgoTs: 13,
    metadata: { reason: 'Insufficient balance' },
  },
  // req-5 Eva: DRAFT → SUBMITTED → CANCELLED
  {
    id: uuid('aud', 10),
    requestIdx: 5,
    actorEmpIdx: 5,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 8,
  },
  {
    id: uuid('aud', 11),
    requestIdx: 5,
    actorEmpIdx: 5,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 7,
  },
  {
    id: uuid('aud', 12),
    requestIdx: 5,
    actorEmpIdx: 5,
    action: 'CANCEL',
    prevStatus: 'SUBMITTED',
    newStatus: 'CANCELLED',
    daysAgoTs: 6,
  },
  // req-6 Frank: DRAFT → SUBMITTED → APPROVED
  {
    id: uuid('aud', 13),
    requestIdx: 6,
    actorEmpIdx: 6,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 12,
  },
  {
    id: uuid('aud', 14),
    requestIdx: 6,
    actorEmpIdx: 6,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 11,
  },
  {
    id: uuid('aud', 15),
    requestIdx: 6,
    actorEmpIdx: 6,
    action: 'APPROVE',
    prevStatus: 'SUBMITTED',
    newStatus: 'APPROVED',
    daysAgoTs: 10,
  },
  // req-7 Grace: DRAFT → SUBMITTED
  {
    id: uuid('aud', 16),
    requestIdx: 7,
    actorEmpIdx: 7,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 1,
  },
  {
    id: uuid('aud', 17),
    requestIdx: 7,
    actorEmpIdx: 7,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 0,
  },
  // req-8 Henry: DRAFT → SUBMITTED → APPROVED (not yet hcm synced)
  {
    id: uuid('aud', 18),
    requestIdx: 8,
    actorEmpIdx: 8,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 3,
  },
  {
    id: uuid('aud', 19),
    requestIdx: 8,
    actorEmpIdx: 8,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 2,
  },
  {
    id: uuid('aud', 20),
    requestIdx: 8,
    actorEmpIdx: 8,
    action: 'APPROVE',
    prevStatus: 'SUBMITTED',
    newStatus: 'APPROVED',
    daysAgoTs: 1,
  },
  // req-9 Isla: DRAFT only
  {
    id: uuid('aud', 21),
    requestIdx: 9,
    actorEmpIdx: 9,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 1,
  },
  // req-10 James: DRAFT → SUBMITTED → REJECTED
  {
    id: uuid('aud', 22),
    requestIdx: 10,
    actorEmpIdx: 10,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 10,
  },
  {
    id: uuid('aud', 23),
    requestIdx: 10,
    actorEmpIdx: 10,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 9,
  },
  {
    id: uuid('aud', 24),
    requestIdx: 10,
    actorEmpIdx: 10,
    action: 'REJECT',
    prevStatus: 'SUBMITTED',
    newStatus: 'REJECTED',
    daysAgoTs: 8,
    metadata: { reason: 'Overlaps with team holiday' },
  },
  // req-11 Karen: DRAFT → SUBMITTED → APPROVED
  {
    id: uuid('aud', 25),
    requestIdx: 11,
    actorEmpIdx: 11,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 4,
  },
  {
    id: uuid('aud', 26),
    requestIdx: 11,
    actorEmpIdx: 11,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 3,
  },
  {
    id: uuid('aud', 27),
    requestIdx: 11,
    actorEmpIdx: 11,
    action: 'APPROVE',
    prevStatus: 'SUBMITTED',
    newStatus: 'APPROVED',
    daysAgoTs: 2,
  },
  // req-12 Liam: DRAFT → SUBMITTED
  {
    id: uuid('aud', 28),
    requestIdx: 12,
    actorEmpIdx: 12,
    action: 'CREATE',
    prevStatus: null,
    newStatus: 'DRAFT',
    daysAgoTs: 2,
  },
  {
    id: uuid('aud', 29),
    requestIdx: 12,
    actorEmpIdx: 12,
    action: 'SUBMIT',
    prevStatus: 'DRAFT',
    newStatus: 'SUBMITTED',
    daysAgoTs: 1,
  },
];

const SYNC_JOBS = [
  {
    id: uuid('syn', 1),
    type: SyncJobType.realtime,
    status: SyncJobStatus.succeeded,
    startedAt: daysAgo(1),
    completedAt: daysAgo(1),
    recordsSynced: 12,
    errors: Prisma.JsonNull,
  },
  {
    id: uuid('syn', 2),
    type: SyncJobType.batch,
    status: SyncJobStatus.succeeded,
    startedAt: daysAgo(7),
    completedAt: daysAgo(7),
    recordsSynced: 48,
    errors: Prisma.JsonNull,
  },
  {
    id: uuid('syn', 3),
    type: SyncJobType.batch,
    status: SyncJobStatus.failed,
    startedAt: daysAgo(14),
    completedAt: daysAgo(14),
    recordsSynced: 5,
    errors: [{ code: 'TIMEOUT', message: 'HCM endpoint timed out' }],
  },
  {
    id: uuid('syn', 4),
    type: SyncJobType.realtime,
    status: SyncJobStatus.running,
    startedAt: new Date(),
    completedAt: null,
    recordsSynced: 0,
    errors: Prisma.JsonNull,
  },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...');

  // Locations
  for (const loc of LOCATIONS) {
    await prisma.location.upsert({
      where: { id: loc.id },
      update: {},
      create: loc,
    });
  }
  console.log(`✅ ${LOCATIONS.length} locations`);

  // Employees
  for (const emp of EMPLOYEES) {
    await prisma.employee.upsert({
      where: { id: emp.id },
      update: {},
      create: emp,
    });
  }
  console.log(`✅ ${EMPLOYEES.length} employees`);

  // Balance snapshots (one per employee, matching their location)
  for (let i = 1; i <= EMPLOYEES.length; i++) {
    const emp = EMPLOYEES[i - 1];
    const locIdx = EMPLOYEE_LOCATION_MAP[i];
    const loc = LOCATIONS[locIdx - 1];
    await prisma.balanceSnapshot.upsert({
      where: {
        employeeId_locationId: { employeeId: emp.id, locationId: loc.id },
      },
      update: {},
      create: {
        id: uuid('bal', i),
        employeeId: emp.id,
        locationId: loc.id,
        availableDays: 15 - (i % 5) * 2, // varied: 15, 13, 11, 9, 15, ...
        pendingDays: i % 3, // varied: 0, 1, 2, 0, 1, ...
        hcmSyncedAt: daysAgo(i),
        version: 1,
      },
    });
  }
  console.log(`✅ ${EMPLOYEES.length} balance snapshots`);

  // Time-off requests
  for (const r of REQUESTS) {
    const emp = EMPLOYEES[r.empIdx - 1];
    const loc = LOCATIONS[r.locIdx - 1];
    await prisma.timeOffRequest.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        employeeId: emp.id,
        locationId: loc.id,
        startDate: daysFromNow(r.startOffset),
        endDate: daysFromNow(r.endOffset),
        daysRequested: r.daysRequested,
        status: r.status,
        hcmSubmitted: r.hcmSubmitted,
        idempotencyKey: r.idempotencyKey,
        createdAt: daysAgo(r.createdDaysAgo),
      },
    });
  }
  console.log(`✅ ${REQUESTS.length} time-off requests`);

  // Audit events
  for (const a of AUDIT_EVENTS) {
    const request = REQUESTS[a.requestIdx - 1];
    const actor = EMPLOYEES[a.actorEmpIdx - 1];
    await prisma.auditEvent.upsert({
      where: { id: a.id },
      update: {},
      create: {
        id: a.id,
        requestId: request.id,
        actorId: actor.id,
        action: a.action,
        prevStatus: a.prevStatus ?? null,
        newStatus: a.newStatus ?? null,
        timestamp: daysAgo(a.daysAgoTs),
        metadata: a.metadata ? a.metadata : undefined,
      },
    });
  }
  console.log(`✅ ${AUDIT_EVENTS.length} audit events`);

  // Sync jobs
  for (const job of SYNC_JOBS) {
    await prisma.syncJob.upsert({
      where: { id: job.id },
      update: {},
      create: job,
    });
  }
  console.log(`✅ ${SYNC_JOBS.length} sync jobs`);

  console.log('🎉 Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
