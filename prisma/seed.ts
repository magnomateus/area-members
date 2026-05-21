import { ContentItemType, PrismaClient, ProductType } from "@prisma/client";

/**
 * Seed de desenvolvimento.
 *
 * Cria o tenant "Missa Explicada" com dados fake mas estruturados: a Offer
 * real (visProductId 20), a Offer DEV de testes de webhook (visProductId
 * 99999, com visWebhookSecret), 1 Product, 1 OfferProduct, 1 ContentItem e
 * 1 User de teste.
 *
 * Idempotente: usa `upsert` com chaves estaveis, pode rodar quantas vezes quiser.
 */
const prisma = new PrismaClient();

// IDs fixos — ContentItem nao tem chave unica natural; garantem idempotencia do seed.
const CONTENT_ITEM_PDF_ID = "11111111-1111-1111-1111-111111111111";
const CONTENT_ITEM_COMMUNITY_ID = "22222222-2222-2222-2222-222222222222";
const CONTENT_ITEM_BONUS_ID = "33333333-3333-3333-3333-333333333333";

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "missa-explicada" },
    update: {},
    create: {
      slug: "missa-explicada",
      name: "Missa Explicada",
      domain: "app.missaexplicada.com.br",
      branding: {
        appName: "Missa Explicada",
        logoUrl: "https://placehold.co/240x80?text=Missa+Explicada",
        primaryColor: "#7C3AED",
        themeColor: "#FFFFFF",
        supportEmail: "suporte@missaexplicada.com.br",
        supportWhatsapp: "+5511999999999",
        manifestIcons: [],
      },
      active: true,
    },
  });

  const offer = await prisma.offer.upsert({
    where: { visProductId: 20 },
    update: {},
    create: {
      tenantId: tenant.id,
      visProductId: 20,
      visProductUuid: "00000000-0000-0000-0000-000000000020",
      name: "Missa Explicada",
      description: "Oferta principal da Missa Explicada — libera o ebook em PDF.",
      price: "197.00",
      // visWebhookSecret: null — produto real ainda nao integrado (Fase 1.7).
      active: true,
    },
  });

  // Offer DEV — produto fake para desenvolver/testar a integracao de webhook.
  // O visWebhookSecret aqui e fake; quando o Mateus criar o produto DEV real
  // na VIS, o Magno atualiza visProductId E visWebhookSecret via Prisma Studio
  // (nao vai pra git). Ver docs/RUNBOOK.md.
  const offerDev = await prisma.offer.upsert({
    where: { visProductId: 99999 },
    update: {},
    create: {
      tenantId: tenant.id,
      visProductId: 99999,
      visProductUuid: "00000000-0000-0000-0000-000000099999",
      name: "Missa Explicada DEV",
      description: "Produto fake para testes da integracao de webhook (Fase 1.3+).",
      price: "1.00",
      visWebhookSecret: "dev-webhook-secret-for-testing-only",
      active: true,
    },
  });

  const product = await prisma.product.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "ebook-missa-explicada" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Ebook Missa Explicada",
      slug: "ebook-missa-explicada",
      type: ProductType.EBOOK,
      description: "Ebook completo da Missa Explicada.",
      sortOrder: 0,
      active: true,
    },
  });

  await prisma.offerProduct.upsert({
    where: { offerId_productId: { offerId: offer.id, productId: product.id } },
    update: {},
    create: {
      offerId: offer.id,
      productId: product.id,
      validityDays: null, // vitalicio
    },
  });

  await prisma.contentItem.upsert({
    where: { id: CONTENT_ITEM_PDF_ID },
    update: {},
    create: {
      id: CONTENT_ITEM_PDF_ID,
      productId: product.id,
      type: ContentItemType.PDF,
      title: "Missa Explicada — PDF principal",
      description: "Arquivo PDF principal do ebook.",
      fileKey: "missa-explicada/ebook-principal.pdf",
      sortOrder: 0,
      active: true,
    },
  });

  // Produtos adicionais — exercitam validityDays distintos no provisionamento.
  const community = await prisma.product.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "comunidade-whatsapp" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Comunidade WhatsApp Catolicos",
      slug: "comunidade-whatsapp",
      type: ProductType.COMMUNITY,
      description: "Acesso ao grupo de WhatsApp da comunidade.",
      sortOrder: 1,
      active: true,
    },
  });

  const bonus = await prisma.product.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: "bonus-pdfs" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Bonus PDFs",
      slug: "bonus-pdfs",
      type: ProductType.BONUS_PACK,
      description: "Pacote de PDFs bonus da Missa Explicada.",
      sortOrder: 2,
      active: true,
    },
  });

  await prisma.contentItem.upsert({
    where: { id: CONTENT_ITEM_COMMUNITY_ID },
    update: {},
    create: {
      id: CONTENT_ITEM_COMMUNITY_ID,
      productId: community.id,
      type: ContentItemType.EXTERNAL_LINK,
      title: "Entrar na comunidade no WhatsApp",
      description: "Link de convite do grupo.",
      externalUrl: "https://chat.whatsapp.com/exemplo-dev",
      sortOrder: 0,
      active: true,
    },
  });

  await prisma.contentItem.upsert({
    where: { id: CONTENT_ITEM_BONUS_ID },
    update: {},
    create: {
      id: CONTENT_ITEM_BONUS_ID,
      productId: bonus.id,
      type: ContentItemType.PDF,
      title: "Pacote de bonus (PDF)",
      description: "Arquivo PDF com os bonus.",
      fileKey: "missa-explicada/bonus-pack.pdf",
      sortOrder: 0,
      active: true,
    },
  });

  // OfferProducts da Offer DEV — libera 3 produtos com validades distintas:
  // ebook (vitalicio), comunidade (90 dias), bonus (vitalicio).
  for (const link of [
    { productId: product.id, validityDays: null },
    { productId: community.id, validityDays: 90 },
    { productId: bonus.id, validityDays: null },
  ]) {
    await prisma.offerProduct.upsert({
      where: { offerId_productId: { offerId: offerDev.id, productId: link.productId } },
      update: {},
      create: {
        offerId: offerDev.id,
        productId: link.productId,
        validityDays: link.validityDays,
      },
    });
  }

  // User de teste — permite exercitar o fluxo de magic link sem simular webhook.
  // Sem senha (passwordHash null): autenticacao apenas por magic link.
  const user = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: "magno@dev.local" } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: "magno@dev.local",
      name: "Magno (dev)",
      phone: null,
    },
  });

  console.log("Seed concluido:");
  console.log(`  Tenant:      ${tenant.name} (${tenant.slug})`);
  console.log(`  Offer:       ${offer.name} — visProductId ${offer.visProductId}`);
  console.log(
    `  Offer DEV:   ${offerDev.name} — visProductId ${offerDev.visProductId} (com webhook secret)`,
  );
  console.log(`  Products:    ${product.name}, ${community.name}, ${bonus.name}`);
  console.log("  OfferProducts: DEV -> ebook (vitalicio), comunidade (90d), bonus (vitalicio)");
  console.log(`  User:        ${user.name} <${user.email}>`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
