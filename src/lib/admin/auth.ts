import { PrismaAdapter } from "@lucia-auth/adapter-prisma";
import { Lucia, TimeSpan } from "lucia";
import { prisma } from "@/lib/db";

/**
 * Lucia Auth do ADMIN — instância separada da do cliente final (`@/lib/auth/lucia`).
 *
 * Separação Admin/Cliente (regra dura da Sub-fase 5.0):
 *  - adapter sobre `AdminSession`/`AdminUser` (tabelas próprias);
 *  - cookie `admin_session` (o cliente usa `auth_session`);
 *  - sessão de 7 dias com renovação rolling do Lucia.
 *
 * O `Register` do Lucia (`declare module "lucia"`) é global e único — fica em
 * `@/lib/auth/lucia`. Esta 2ª instância NÃO redeclara. Por isso o helper
 * `getAdminSession()` (session.ts) re-consulta `AdminUser` pelo id em vez de
 * confiar na tipagem de `getUserAttributes`.
 */
const adapter = new PrismaAdapter(prisma.adminSession, prisma.adminUser);

export const adminLucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(7, "d"),
  sessionCookie: {
    name: "admin_session",
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  },
  getUserAttributes: (attributes) => ({
    email: attributes.email,
    name: attributes.name,
  }),
});
