-- CreateEnum
CREATE TYPE "NeetYearStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "NeetRankBasis" AS ENUM ('EXACT_TIES', 'BAND_INTERPOLATION');

-- CreateEnum
CREATE TYPE "NeetGroup" AS ENUM ('OVERALL', 'GENERAL', 'EWS', 'OBC', 'SC', 'ST', 'PWD');

-- CreateTable
CREATE TABLE "neet_exam_years" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "NeetYearStatus" NOT NULL DEFAULT 'DRAFT',
    "appeared" INTEGER NOT NULL,
    "qualified" INTEGER,
    "topperScore" INTEGER,
    "resultDate" DATE,
    "basis" "NeetRankBasis",
    "methodNote" TEXT,
    "sourceId" UUID NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "distributionFileName" TEXT,
    "distributionSha256" TEXT,
    "distributionUploadedAt" TIMESTAMP(3),
    "tableHash" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neet_exam_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neet_qualifying_cutoffs" (
    "examYearId" UUID NOT NULL,
    "group" "NeetGroup" NOT NULL,
    "percentile" DOUBLE PRECISION NOT NULL,
    "minScore" INTEGER NOT NULL,

    CONSTRAINT "neet_qualifying_cutoffs_pkey" PRIMARY KEY ("examYearId","group")
);

-- CreateTable
CREATE TABLE "neet_score_distribution" (
    "examYearId" UUID NOT NULL,
    "group" "NeetGroup" NOT NULL,
    "scoreFrom" INTEGER NOT NULL,
    "scoreTo" INTEGER NOT NULL,
    "candidates" INTEGER NOT NULL,

    CONSTRAINT "neet_score_distribution_pkey" PRIMARY KEY ("examYearId","group","scoreFrom")
);

-- CreateTable
CREATE TABLE "neet_rank_rows" (
    "examYearId" UUID NOT NULL,
    "group" "NeetGroup" NOT NULL,
    "score" INTEGER NOT NULL,
    "rankFrom" INTEGER NOT NULL,
    "rankTo" INTEGER NOT NULL,
    "spanFrom" INTEGER NOT NULL,
    "spanTo" INTEGER NOT NULL,
    "percentile" DOUBLE PRECISION NOT NULL,
    "candidatesAtScore" INTEGER NOT NULL,

    CONSTRAINT "neet_rank_rows_pkey" PRIMARY KEY ("examYearId","group","score")
);

-- CreateIndex
CREATE UNIQUE INDEX "neet_exam_years_year_key" ON "neet_exam_years"("year");

-- CreateIndex
CREATE INDEX "neet_exam_years_status_year_idx" ON "neet_exam_years"("status", "year");

-- AddForeignKey
ALTER TABLE "neet_exam_years" ADD CONSTRAINT "neet_exam_years_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neet_qualifying_cutoffs" ADD CONSTRAINT "neet_qualifying_cutoffs_examYearId_fkey" FOREIGN KEY ("examYearId") REFERENCES "neet_exam_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neet_score_distribution" ADD CONSTRAINT "neet_score_distribution_examYearId_fkey" FOREIGN KEY ("examYearId") REFERENCES "neet_exam_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neet_rank_rows" ADD CONSTRAINT "neet_rank_rows_examYearId_fkey" FOREIGN KEY ("examYearId") REFERENCES "neet_exam_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
