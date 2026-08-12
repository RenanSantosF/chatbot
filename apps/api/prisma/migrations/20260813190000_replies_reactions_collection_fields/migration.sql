-- CreateEnum
CREATE TYPE "CollectionFieldType" AS ENUM ('TEXT', 'EMAIL', 'PHONE', 'DOCUMENT', 'DATE', 'NUMBER');

-- CreateEnum
CREATE TYPE "CollectionFieldTarget" AS ENUM ('NAME', 'EMAIL', 'METADATA');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "replyToId" TEXT,
ADD COLUMN     "reactions" JSONB;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "collection_fields" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "type" "CollectionFieldType" NOT NULL DEFAULT 'TEXT',
    "target" "CollectionFieldTarget" NOT NULL DEFAULT 'METADATA',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_fields_tenantId_key_key" ON "collection_fields"("tenantId", "key");

-- CreateIndex
CREATE INDEX "collection_fields_tenantId_active_idx" ON "collection_fields"("tenantId", "active");

-- AddForeignKey
ALTER TABLE "collection_fields" ADD CONSTRAINT "collection_fields_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
