-- CreateEnum
CREATE TYPE "NewsSourceKind" AS ENUM ('RSS', 'WP_REST', 'HTML_LIST', 'HTML_JS');

-- CreateEnum
CREATE TYPE "NewsSourceStatus" AS ENUM ('OK', 'DEGRADED', 'BROKEN');

-- CreateEnum
CREATE TYPE "NewsItemStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'FILTERED', 'BASELINE', 'UNPUBLISHED');

-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('COUNSELLING', 'SCHEDULE', 'SEAT_MATRIX', 'MERIT_LIST', 'REGISTRATION', 'RESULT', 'FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "NewsDateBasis" AS ENUM ('SOURCE', 'PDF', 'FIRST_SEEN');

-- CreateEnum
CREATE TYPE "NewsRunOutcome" AS ENUM ('OK', 'NOT_MODIFIED', 'ERROR', 'BLOCKED_BY_ROBOTS');

-- CreateTable
CREATE TABLE "news_sources" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stateId" UUID,
    "kind" "NewsSourceKind" NOT NULL,
    "listUrl" TEXT NOT NULL,
    "siteUrl" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fetchIntervalMin" INTEGER NOT NULL DEFAULT 180,
    "notes" TEXT,
    "status" "NewsSourceStatus" NOT NULL DEFAULT 'OK',
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastItemCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveEmptyRuns" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "baselineAt" TIMESTAMP(3),
    "etag" TEXT,
    "lastModified" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_items" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "stateId" UUID,
    "title" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "snippet" TEXT,
    "sourcePublishedAt" TIMESTAMP(3),
    "dateBasis" "NewsDateBasis" NOT NULL DEFAULT 'FIRST_SEEN',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relevanceScore" INTEGER NOT NULL DEFAULT 0,
    "category" "NewsCategory" NOT NULL DEFAULT 'OTHER',
    "status" "NewsItemStatus" NOT NULL DEFAULT 'PENDING',
    "publicTitle" TEXT,
    "summary" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_fetch_runs" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER NOT NULL,
    "outcome" "NewsRunOutcome" NOT NULL,
    "httpStatus" INTEGER,
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsNew" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "news_fetch_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_sources_slug_key" ON "news_sources"("slug");

-- CreateIndex
CREATE INDEX "news_sources_isActive_stateId_idx" ON "news_sources"("isActive", "stateId");

-- CreateIndex
CREATE UNIQUE INDEX "news_items_slug_key" ON "news_items"("slug");

-- CreateIndex
CREATE INDEX "news_items_status_firstSeenAt_idx" ON "news_items"("status", "firstSeenAt");

-- CreateIndex
CREATE INDEX "news_items_status_stateId_publishedAt_idx" ON "news_items"("status", "stateId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "news_items_sourceId_urlHash_key" ON "news_items"("sourceId", "urlHash");

-- CreateIndex
CREATE INDEX "news_fetch_runs_sourceId_startedAt_idx" ON "news_fetch_runs"("sourceId", "startedAt");

-- AddForeignKey
ALTER TABLE "news_sources" ADD CONSTRAINT "news_sources_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "news_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "states"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_fetch_runs" ADD CONSTRAINT "news_fetch_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
