-- O-12 (Time & Leave closure audit, 28 Oct 2026): indexes on the columns the
-- Time & Leave migrations of 29-31 Oct added and the routes query, which had
-- none. Additive only; every one is mirrored by an @@index in schema.prisma.

-- Cancelling a WFH / On duty / Permission request finds the days it wrote
-- (services/attendance/requests.ts).
CREATE INDEX "AttendanceRecord_attendanceRequestId_idx" ON "AttendanceRecord"("attendanceRequestId");

-- "Comp-off for this day is already granted" (routes/leave.ts, selfService.ts).
CREATE INDEX "LeaveAdjustment_orgId_employeeId_leaveTypeId_workedOn_idx" ON "LeaveAdjustment"("orgId", "employeeId", "leaveTypeId", "workedOn");

-- A year-end run's pay-outs, read and deleted on undo.
CREATE INDEX "LeaveAdjustment_yearEndId_idx" ON "LeaveAdjustment"("yearEndId");

-- The parts of leave split at the period end, read, edited and cancelled together.
CREATE INDEX "LeaveRequest_orgId_groupId_idx" ON "LeaveRequest"("orgId", "groupId");

-- Whose approvals someone is standing in for today (services/attendance/standIns.ts).
CREATE INDEX "ApprovalStandIn_orgId_standInEmployeeId_fromDate_toDate_idx" ON "ApprovalStandIn"("orgId", "standInEmployeeId", "fromDate", "toDate");
