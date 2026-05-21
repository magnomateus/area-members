/**
 * Leitura defensiva do JSON `Tenant.branding`.
 *
 * `branding` é um campo Json livre — esta função extrai os campos usados pela
 * UI com defaults seguros, sem `any`.
 */
export interface TenantBranding {
  appName: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

export function readBranding(branding: unknown): TenantBranding {
  const b = (branding ?? {}) as Record<string, unknown>;
  return {
    appName: typeof b.appName === "string" ? b.appName : "Área de Membros",
    logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null,
    primaryColor: typeof b.primaryColor === "string" ? b.primaryColor : null,
  };
}
