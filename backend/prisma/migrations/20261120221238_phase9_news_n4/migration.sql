-- AlterTable
ALTER TABLE "news_items" ADD COLUMN     "duplicateOfId" UUID,
ADD COLUMN     "relevanceReasons" TEXT[],
ADD COLUMN     "titleKey" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "news_items_titleKey_idx" ON "news_items"("titleKey");

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "news_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
