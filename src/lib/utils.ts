import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn` — combina classes Tailwind condicionais (`clsx`) resolvendo conflitos
 * (`tailwind-merge`). Utilitário base do shadcn/ui. Ver
 * docs/DECISIONS/003-shadcn-ui-admin.md.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
