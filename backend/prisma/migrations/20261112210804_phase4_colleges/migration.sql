-- CreateEnum
CREATE TYPE "CollegeKind" AS ENUM ('INDIA', 'ABROAD');

-- CreateEnum
CREATE TYPE "CollegeStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CollegeOwnership" AS ENUM ('GOVERNMENT', 'PRIVATE', 'DEEMED', 'TRUST');

-- CreateEnum
CREATE TYPE "LocationBasis" AS ENUM ('WELL_KNOWN', 'IN_COLLEGE_NAME', 'CHECKED_ONLINE');

-- CreateEnum
CREATE TYPE "WdomsStatus" AS ENUM ('LISTED', 'NOT_LISTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CollegeSourcePurpose" AS ENUM ('WDOMS', 'FEE_NOTICE', 'NMC_NOTICES', 'NMC_RECOGNITION', 'SEAT_LIST', 'COUNSELLING', 'COLLEGE_WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('COLLEGES', 'FEES', 'MOCK_SAMPLE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'COMMITTED', 'FAILED');

-- CreateTable
CREATE TABLE "colleges" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "CollegeKind" NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "city" TEXT NOT NULL,
    "stateId" UUID,
    "countryId" UUID,
    "ownership" "CollegeOwnership",
    "establishedYear" INTEGER,
    "courseLengthMonths" INTEGER,
    "description" TEXT,
    "heroImageUrl" TEXT,
    "websiteUrl" TEXT,
    "status" "CollegeStatus" NOT NULL DEFAULT 'DRAFT',
    "readyAt" TIMESTAMP(3),
    "totalCourseFeeInr" INTEGER,
    "totalFeeCalculatedAt" TIMESTAMP(3),
    "locationBasis" "LocationBasis",
    "internalNotes" TEXT,
    "importBatchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "colleges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_india_profiles" (
    "collegeId" UUID NOT NULL,
    "nmcRecognised" BOOLEAN,
    "nmcRecognitionCheckedAt" TIMESTAMP(3),
    "mbbsSeats" INTEGER,
    "hospitalName" TEXT,
    "hospitalBeds" INTEGER,
    "dailyOutpatients" INTEGER,
    "serviceBondYears" INTEGER,
    "serviceBondPenaltyInr" INTEGER,
    "stipendInr" INTEGER,
    "domicileRule" TEXT,

    CONSTRAINT "college_india_profiles_pkey" PRIMARY KEY ("collegeId")
);

-- CreateTable
CREATE TABLE "college_abroad_profiles" (
    "collegeId" UUID NOT NULL,
    "wdomsListed" "WdomsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "wdomsId" TEXT,
    "wdomsUrl" TEXT,
    "wdomsCheckedAt" TIMESTAMP(3),
    "internshipMonths" INTEGER,
    "teachingLanguage" TEXT,
    "languageNote" TEXT,
    "intakeMonths" INTEGER[],
    "seatsForIndians" INTEGER,
    "nmcLengthOk" BOOLEAN,
    "nmcEnglishOk" BOOLEAN,
    "nmcInternshipOk" BOOLEAN,
    "nmcCheckedAt" TIMESTAMP(3),
    "eligibility" JSONB,
    "documents" TEXT[],

    CONSTRAINT "college_abroad_profiles_pkey" PRIMARY KEY ("collegeId")
);

-- CreateTable
CREATE TABLE "college_fee_lines" (
    "id" UUID NOT NULL,
    "collegeId" UUID NOT NULL,
    "yearNumber" INTEGER NOT NULL,
    "tuition" DECIMAL(14,2) NOT NULL,
    "hostel" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "sourceId" UUID,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "college_fee_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "currency" VARCHAR(3) NOT NULL,
    "rateToInr" DECIMAL(18,6) NOT NULL,
    "asOf" DATE NOT NULL,
    "sourceNote" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "college_source_links" (
    "id" UUID NOT NULL,
    "collegeId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "purpose" "CollegeSourcePurpose" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "checkedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "college_source_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "college_faqs" (
    "id" UUID NOT NULL,
    "collegeId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "college_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "stats" JSONB,
    "errors" JSONB,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colleges_slug_key" ON "colleges"("slug");

-- CreateIndex
CREATE INDEX "colleges_status_kind_idx" ON "colleges"("status", "kind");

-- CreateIndex
CREATE INDEX "colleges_countryId_status_idx" ON "colleges"("countryId", "status");

-- CreateIndex
CREATE INDEX "colleges_stateId_status_idx" ON "colleges"("stateId", "status");

-- CreateIndex
CREATE INDEX "colleges_importBatchId_idx" ON "colleges"("importBatchId");

-- CreateIndex
CREATE INDEX "college_fee_lines_currency_idx" ON "college_fee_lines"("currency");

-- CreateIndex
CREATE INDEX "college_fee_lines_sourceId_idx" ON "college_fee_lines"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "college_fee_lines_collegeId_yearNumber_key" ON "college_fee_lines"("collegeId", "yearNumber");

-- CreateIndex
CREATE INDEX "college_source_links_sourceId_idx" ON "college_source_links"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "college_source_links_collegeId_sourceId_purpose_key" ON "college_source_links"("collegeId", "sourceId", "purpose");

-- CreateIndex
CREATE INDEX "college_faqs_collegeId_sort_idx" ON "college_faqs"("collegeId", "sort");

-- CreateIndex
CREATE INDEX "import_batches_kind_createdAt_idx" ON "import_batches"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_india_profiles" ADD CONSTRAINT "college_india_profiles_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_abroad_profiles" ADD CONSTRAINT "college_abroad_profiles_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_fee_lines" ADD CONSTRAINT "college_fee_lines_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_fee_lines" ADD CONSTRAINT "college_fee_lines_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_source_links" ADD CONSTRAINT "college_source_links_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_source_links" ADD CONSTRAINT "college_source_links_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "college_faqs" ADD CONSTRAINT "college_faqs_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nmc_notices" ADD CONSTRAINT "nmc_notices_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "colleges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Safety nets the Prisma schema cannot express. The admin API validates first and reports field errors;
-- these make sure nothing else can write an inconsistent row.
-- An India college has a state and no country; an abroad college has a country and no state (both may be empty while a draft).
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_kind_location_check"
  CHECK (
    ("kind" = 'INDIA' AND "countryId" IS NULL) OR
    ("kind" = 'ABROAD' AND "stateId" IS NULL)
  );
-- Only a READY college has a readyAt date.
ALTER TABLE "colleges" ADD CONSTRAINT "colleges_ready_at_check"
  CHECK (("status" = 'READY') = ("readyAt" IS NOT NULL) OR "status" = 'ARCHIVED');
ALTER TABLE "college_fee_lines" ADD CONSTRAINT "college_fee_lines_year_check" CHECK ("yearNumber" BETWEEN 1 AND 12);
ALTER TABLE "college_fee_lines" ADD CONSTRAINT "college_fee_lines_amounts_check" CHECK ("tuition" >= 0 AND "hostel" >= 0 AND "other" >= 0);
ALTER TABLE "college_fee_lines" ADD CONSTRAINT "college_fee_lines_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$' AND "currency" <> 'INR');
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_rate_check" CHECK ("rateToInr" > 0);
