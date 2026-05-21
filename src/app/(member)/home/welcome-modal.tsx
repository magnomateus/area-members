"use client";

import { useState } from "react";

/**
 * Modal full-screen de boas-vindas no primeiro acesso (`?first=1`).
 * Estado em memória: ao fechar, NÃO reaparece na mesma sessão (sem cookie /
 * localStorage). Remove o `?first=1` da URL via `history.replaceState`.
 */
function CheckIcon() {
  return (
    <svg className="h-16 w-16 text-green-500" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 12.5l3.5 3.5L17 9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WelcomeModal({ userName }: { userName: string | null }) {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  const close = (): void => {
    setOpen(false);
    window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/80 p-6 backdrop-blur-sm">
      <div className="animate-welcome flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-gradient-to-b from-white to-gray-100 p-8 text-center shadow-xl">
        <CheckIcon />
        <h2 className="text-2xl font-bold text-gray-900">
          {userName ? `Bem-vindo, ${userName}!` : "Bem-vindo!"}
        </h2>
        <p className="text-sm font-medium text-gray-600">Seu acesso está liberado</p>
        <p className="text-sm text-gray-500">
          Tudo certo! Seu material já está disponível e você tem acesso vitalício.
        </p>
        <button
          type="button"
          onClick={close}
          className="mt-2 w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-semibold text-white"
        >
          Acessar minha área
        </button>
      </div>
    </div>
  );
}
