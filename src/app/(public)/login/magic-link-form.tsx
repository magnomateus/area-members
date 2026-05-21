"use client";

import { useActionState, useState } from "react";
import { type LoginFormState, requestMagicLinkAction } from "./actions";

const initialState: LoginFormState = { message: null };

const REASON_BANNERS: Record<string, { text: string; className: string }> = {
  expired: {
    text: "Seu link de acesso expirou. Receba um novo abaixo.",
    className: "bg-amber-50 text-amber-800",
  },
  used: {
    text: "Este link já foi usado. Solicite um novo abaixo.",
    className: "bg-blue-50 text-blue-800",
  },
  invalid: {
    text: "Link inválido. Solicite um novo abaixo.",
    className: "bg-gray-100 text-gray-700",
  },
};

export function MagicLinkForm({
  defaultEmail = "",
  reason = null,
}: {
  defaultEmail?: string;
  reason?: string | null;
}) {
  const [state, formAction, pending] = useActionState(requestMagicLinkAction, initialState);
  const [showBanner, setShowBanner] = useState(true);

  const banner = reason === null ? undefined : REASON_BANNERS[reason];

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      {banner && showBanner ? (
        <p className={`rounded-lg px-3 py-2 text-sm ${banner.className}`} role="status">
          {banner.text}
        </p>
      ) : null}
      <label htmlFor="email" className="text-sm font-medium text-gray-700">
        Seu email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        defaultValue={defaultEmail}
        placeholder="voce@exemplo.com"
        onChange={() => {
          setShowBanner(false);
        }}
        className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base outline-none focus:border-gray-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Enviar link de acesso"}
      </button>
      {state.message ? (
        <p role="status" className="text-sm text-gray-600">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
