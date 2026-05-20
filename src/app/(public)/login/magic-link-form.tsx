"use client";

import { useActionState } from "react";
import { type LoginFormState, requestMagicLinkAction } from "./actions";

const initialState: LoginFormState = { message: null };

export function MagicLinkForm() {
  const [state, formAction, pending] = useActionState(requestMagicLinkAction, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <label htmlFor="email" className="text-sm font-medium text-gray-700">
        Seu email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="voce@exemplo.com"
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
