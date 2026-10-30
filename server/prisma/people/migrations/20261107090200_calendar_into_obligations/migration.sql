-- One place for compliance (People audit 30 Oct 2026, gap 10): the old compliance
-- calendar's deadlines become obligations, so People shows them on the Compliance
-- screen beside what the rule library brings. Statutory deadlines (PF ECR, ESIC,
-- TDS, 24Q, Form 16, bonus, Professional Tax, the POSH report) keep their code as
-- the rule id and their period, which is how Compliance goes on making them; the
-- company's own deadlines become its own obligations. Owner, reference, note, done
-- and the evidence file come across. Copies only: the calendar's rows stay.
--
-- Runs as the application role, which is not a superuser: every table here forces
-- row-level security, so the copy needs the bypass or it would see no rows at all.
-- Each row is copied once (its id is derived from the calendar's), so a second run
-- adds nothing.
SET clor.bypass = 'on';

INSERT INTO "Obligation" ("id", "accountId", "orgId", "ruleId", "ruleVersion", "establishmentId", "period", "title", "dueOn",
                          "ownerUserId", "ownerName", "status", "proofDocIds", "note", "reference", "source",
                          "dueToldAt", "doneAt", "doneByUserId", "createdAt", "updatedAt")
SELECT 'cal_' || t."id", t."accountId", t."orgId",
       CASE WHEN t."code" = 'CUSTOM' THEN 'OWN' ELSE t."code" END, 0, NULL, t."period", t."title", t."dueDate",
       NULL, NULLIF(btrim(t."owner"), ''),
       CASE t."status" WHEN 'DONE' THEN 'DONE' WHEN 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE' ELSE 'UPCOMING' END,
       '[]'::jsonb, t."note", t."reference",
       CASE WHEN t."code" = 'CUSTOM' THEN 'OWN' ELSE 'STATUTORY' END,
       -- Already on the calendar people were reading: not announced again as "due soon".
       CASE WHEN t."dueDate" <= to_char((now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '14 days', 'YYYY-MM-DD') THEN now() ELSE NULL END,
       t."doneAt", t."doneByUserId", t."createdAt", now()
FROM "ComplianceTask" t
WHERE t."code" <> 'POSH_REPORT' AND NOT EXISTS (
  SELECT 1 FROM "Obligation" o
  WHERE o."orgId" = t."orgId" AND o."establishmentId" IS NULL AND o."period" = t."period"
    AND o."ruleId" = CASE WHEN t."code" = 'CUSTOM' THEN 'OWN' ELSE t."code" END
)
ON CONFLICT DO NOTHING;

-- The POSH annual report is also a rule in the library (IN-POSH-REPORT, period = the
-- calendar year reported on, due 31 January after it). The calendar named the period by
-- the year it fell due in, so 2027 there is 2026 here. It joins the rule's own row when
-- Compliance already made one, and otherwise becomes that row, so the report is never
-- listed twice.
INSERT INTO "Obligation" ("id", "accountId", "orgId", "ruleId", "ruleVersion", "establishmentId", "period", "title", "dueOn",
                          "ownerUserId", "ownerName", "status", "proofDocIds", "note", "reference", "source",
                          "dueToldAt", "doneAt", "doneByUserId", "createdAt", "updatedAt")
SELECT 'cal_' || t."id", t."accountId", t."orgId", 'IN-POSH-REPORT',
       COALESCE((SELECT MAX(r."version") FROM "ComplianceRule" r WHERE r."orgId" = t."orgId" AND r."ruleId" = 'IN-POSH-REPORT' AND r."active"), 1),
       NULL, (CASE WHEN t."period" ~ '^[0-9]{4}$' THEN (t."period"::int - 1)::text END),
       'POSH: annual report of the Internal Committee (' || (CASE WHEN t."period" ~ '^[0-9]{4}$' THEN (t."period"::int - 1)::text END) || ')', t."dueDate",
       NULL, NULLIF(btrim(t."owner"), ''),
       CASE t."status" WHEN 'DONE' THEN 'DONE' WHEN 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE' ELSE 'UPCOMING' END,
       '[]'::jsonb, t."note", t."reference", 'RULE',
       CASE WHEN t."dueDate" <= to_char((now() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '14 days', 'YYYY-MM-DD') THEN now() ELSE NULL END,
       t."doneAt", t."doneByUserId", t."createdAt", now()
FROM "ComplianceTask" t
WHERE t."code" = 'POSH_REPORT' AND t."period" ~ '^[0-9]{4}$'
  AND NOT EXISTS (
    SELECT 1 FROM "Obligation" o
    WHERE o."orgId" = t."orgId" AND o."establishmentId" IS NULL AND o."ruleId" = 'IN-POSH-REPORT' AND o."period" = (CASE WHEN t."period" ~ '^[0-9]{4}$' THEN (t."period"::int - 1)::text END)
  )
ON CONFLICT DO NOTHING;

-- Where the rule's row was already there, what the calendar knew (done, owner, reference,
-- note) is carried onto it, unless someone has already acted on it in Compliance.
UPDATE "Obligation" o
SET "status" = CASE t."status" WHEN 'DONE' THEN 'DONE' WHEN 'NOT_APPLICABLE' THEN 'NOT_APPLICABLE' ELSE o."status" END,
    "doneAt" = COALESCE(o."doneAt", t."doneAt"), "doneByUserId" = COALESCE(o."doneByUserId", t."doneByUserId"),
    "ownerName" = COALESCE(o."ownerName", NULLIF(btrim(t."owner"), '')), "reference" = COALESCE(o."reference", t."reference"),
    "note" = COALESCE(o."note", t."note"), "updatedAt" = now()
FROM "ComplianceTask" t
WHERE t."code" = 'POSH_REPORT' AND t."period" ~ '^[0-9]{4}$' AND t."status" IN ('DONE', 'NOT_APPLICABLE')
  AND o."orgId" = t."orgId" AND o."establishmentId" IS NULL AND o."ruleId" = 'IN-POSH-REPORT' AND o."period" = (CASE WHEN t."period" ~ '^[0-9]{4}$' THEN (t."period"::int - 1)::text END)
  AND o."id" <> 'cal_' || t."id" AND o."status" NOT IN ('DONE', 'CHECKED', 'NOT_APPLICABLE');

-- The evidence file, as the obligation's first proof. A file already in object storage
-- keeps its key (both rows name the same object; the nightly check keeps it).
INSERT INTO "ObligationProof" ("id", "accountId", "orgId", "obligationId", "name", "mime", "size", "data", "storageKey", "uploadedByUserId", "createdAt")
SELECT 'cal_' || t."id", t."accountId", t."orgId", target."id",
       COALESCE(NULLIF(t."evidenceName", ''), 'Evidence'), COALESCE(t."evidenceMime", 'application/pdf'),
       COALESCE(octet_length(t."evidenceData"), 0), COALESCE(t."evidenceData", '\x'::bytea), t."evidenceKey",
       t."doneByUserId", t."updatedAt"
FROM "ComplianceTask" t
JOIN LATERAL (
  SELECT o."id" FROM "Obligation" o
  WHERE o."id" = 'cal_' || t."id"
     OR (t."code" = 'POSH_REPORT' AND t."period" ~ '^[0-9]{4}$' AND o."orgId" = t."orgId" AND o."establishmentId" IS NULL
         AND o."ruleId" = 'IN-POSH-REPORT' AND o."period" = (CASE WHEN t."period" ~ '^[0-9]{4}$' THEN (t."period"::int - 1)::text END))
  ORDER BY (o."id" = 'cal_' || t."id") DESC
  LIMIT 1
) target ON TRUE
WHERE (t."evidenceData" IS NOT NULL AND octet_length(t."evidenceData") > 0) OR t."evidenceKey" IS NOT NULL
ON CONFLICT DO NOTHING;

RESET clor.bypass;
