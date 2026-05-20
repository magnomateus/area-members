"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requestMagicLink } from "@/lib/auth/magic-link";

/**
 * Server Action da página `/login`. Chama a mesma lógica (`requestMagicLink`)
 * do endpoint `POST /api/auth/magic-link` — rate limit e anti-enumeração ficam
 * na camada compartilhada.
 */
const schema = z.object({ email: z.string().email() });

export type LoginFormState = { message: string | null };

const GENERIC_MESSAGE =
  "Se este email estiver cadastrado, enviamos o link de acesso para seu WhatsApp e email.";

function clientIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return requestHeaders.get("x-real-ip") ?? "unknown";
}

export async function requestMagicLinkAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { message: "Informe um email válido." };
  }

  const requestHeaders = await headers();
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  const host = requestHeaders.get("host") ?? "localhost:3000";

  await requestMagicLink({
    email: parsed.data.email,
    ip: clientIp(requestHeaders),
    baseUrl: `${proto}://${host}`,
  });

  return { message: GENERIC_MESSAGE };
}
