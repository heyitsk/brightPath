-- CreateEnum
CREATE TYPE "CountryStatus" AS ENUM ('LIVE', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('NTA', 'MCC', 'STATE_COUNSELLING', 'NMC', 'WDOMS', 'COLLEGE_WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "NmcNoticeSeverity" AS ENUM ('ADVISORY', 'WARNING');

-- CreateEnum
CREATE TYPE "NmcNoticeScope" AS ENUM ('COLLEGE', 'COUNTRY');

-- CreateTable
CREATE TABLE "states" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 1000,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isoCode" TEXT NOT NULL,
    "status" "CountryStatus" NOT NULL DEFAULT 'COMING_SOON',
    "nearIndia" BOOLEAN NOT NULL DEFAULT false,
    "typicalFlightFromDelhi" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 1000,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "url" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nmc_notices" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "severity" "NmcNoticeSeverity" NOT NULL,
    "scope" "NmcNoticeScope" NOT NULL,
    "countryId" UUID,
    "collegeId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nmc_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "states_slug_key" ON "states"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "states_code_key" ON "states"("code");

-- CreateIndex
CREATE INDEX "states_isLive_sortOrder_idx" ON "states"("isLive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "countries_slug_key" ON "countries"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "countries_isoCode_key" ON "countries"("isoCode");

-- CreateIndex
CREATE INDEX "countries_status_sortOrder_idx" ON "countries"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "sources_kind_idx" ON "sources"("kind");

-- CreateIndex
CREATE INDEX "nmc_notices_countryId_isActive_idx" ON "nmc_notices"("countryId", "isActive");

-- CreateIndex
CREATE INDEX "nmc_notices_collegeId_isActive_idx" ON "nmc_notices"("collegeId", "isActive");

-- AddForeignKey
ALTER TABLE "nmc_notices" ADD CONSTRAINT "nmc_notices_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
