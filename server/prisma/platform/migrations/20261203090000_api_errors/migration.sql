-- Each time the API fails a request (a 500): when, which route, and the request id the customer was shown.
-- Platform data read only by CLOR operators; no account policy. Rows are pruned after 14 days by the alerts job.
CREATE TABLE "ApiError" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "errorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiError_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ApiError_createdAt_idx" ON "ApiError"("createdAt");
CREATE INDEX "ApiError_requestId_idx" ON "ApiError"("requestId");
