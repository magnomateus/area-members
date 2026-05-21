/*
  Warnings:

  - You are about to drop the column `visWebhookSecret` on the `Tenant` table. All the data in the column will be lost.
  - Added the required column `rawHeaders` to the `WebhookDelivery` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "visWebhookSecret" TEXT;

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "visWebhookSecret";

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "rawHeaders" JSONB NOT NULL,
ADD COLUMN     "signatureReason" TEXT;
