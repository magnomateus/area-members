import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { Lucia, TimeSpan } from "lucia";
import { prisma } from "@/lib/db";

/**
 * Configuração do Lucia Auth v3.
 *
 * Sessão: cookie httpOnly (padrão do Lucia), secure em prod, sameSite=lax,
 * validade de 30 dias com renovação rolling (o Lucia estende a sessão na
 * metade do tempo de vida ao validar). Ver ARCHITECTURE.md seção 6.
 */
const adapter = new PrismaAdapter(prisma.session, prisma.user);

export const lucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(30, "d"),
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  },
  getUserAttributes: (attributes) => ({
    tenantId: attributes.tenantId,
    email: attributes.email,
    name: attributes.name,
  }),
});

interface DatabaseUserAttributes {
  tenantId: string;
  email: string;
  name: string | null;
}

declare module "lucia" {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: DatabaseUserAttributes;
  }
}
