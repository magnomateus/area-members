"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CenteredCard } from "@/components/public/centered-card";
import {
  computePollingInterval,
  computeProgressBarPercent,
  getRotatingSubtext,
} from "@/lib/polling/strategy";

/**
 * Tela de polling pós-compra. Consulta `/api/orders/status` em intervalos
 * crescentes (2s → 3s → 5s) e reage aos estados pending/ready/failed/timeout.
 *
 * A barra de progresso é PURAMENTE VISUAL (ver lib/polling/strategy.ts) — não
 * reflete o provisionamento real. Estado fica só em memória (sem localStorage).
 */
type Phase = "pending" | "ready" | "failed" | "timeout";

interface Props {
  orderId: number;
  email: string;
  logoUrl: string | null;
  supportWhatsappUrl: string | null;
}

interface StatusResponse {
  status?: string;
  reason?: string;
  redirectUrl?: string;
}

const FIRST_ROUND_BUDGET_SEC = 90;
const RESEND_ROUND_BUDGET_SEC = 60;
const READY_REDIRECT_DELAY_MS = 800;

const FAIL_MESSAGES: Record<string, string> = {
  refused: "Seu pagamento foi recusado. Verifique seu cartão e tente novamente.",
  cancelled: "Seu pedido foi cancelado.",
  chargedback: "Detectamos uma divergência neste pedido. Entre em contato com o suporte.",
};

function Spinner() {
  return (
    <svg
      className="h-12 w-12 animate-spin text-gray-900"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="h-12 w-12 text-red-500" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-12 w-12 text-amber-500" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
      <div
        className="h-full rounded-full bg-gray-900 transition-all duration-700 ease-out"
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}

export function PollingScreen({ orderId, email, logoUrl, supportWhatsappUrl }: Props) {
  const [phase, setPhase] = useState<Phase>("pending");
  const [failReason, setFailReason] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // Relógio do polling — `Date.now()` é chamado em efeitos/handlers, nunca no render.
  const startRef = useRef(0);
  const budgetRef = useRef(FIRST_ROUND_BUDGET_SEC);

  useEffect(() => {
    startRef.current = Date.now();
  }, []);

  // Tick de 1s — alimenta a barra de progresso e o subtexto rotativo.
  useEffect(() => {
    if (phase !== "pending") return;
    const id = setInterval(() => {
      if (startRef.current === 0) return;
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [phase]);

  // Polling com intervalo crescente.
  useEffect(() => {
    if (phase !== "pending") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (): Promise<void> => {
      const elapsedSec = startRef.current === 0 ? 0 : (Date.now() - startRef.current) / 1000;
      if (elapsedSec >= budgetRef.current) {
        if (!cancelled) setPhase("timeout");
        return;
      }
      try {
        const res = await fetch(
          `/api/orders/status?order_id=${String(orderId)}&email=${encodeURIComponent(email)}`,
        );
        const data = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (data.status === "ready" && typeof data.redirectUrl === "string") {
          const target = data.redirectUrl;
          setPhase("ready");
          // location.href (não router.push): redirect entre layouts (public → member).
          setTimeout(() => {
            window.location.href = target;
          }, READY_REDIRECT_DELAY_MS);
          return;
        }
        if (data.status === "failed") {
          setFailReason(data.reason ?? null);
          setPhase("failed");
          return;
        }
      } catch {
        // Falha de rede transitória — continua tentando.
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), computePollingInterval(elapsedSec));
      }
    };

    timer = setTimeout(() => void poll(), computePollingInterval(0));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, orderId, email]);

  const handleResend = useCallback(async () => {
    setResending(true);
    try {
      await fetch("/api/auth/resend-magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, email }),
      });
      setResent(true);
      // Retoma o polling por mais 60s.
      startRef.current = Date.now();
      budgetRef.current = RESEND_ROUND_BUDGET_SEC;
      setElapsed(0);
      setPhase("pending");
    } catch {
      // ignora — o botão volta a ficar disponível
    } finally {
      setResending(false);
    }
  }, [orderId, email]);

  if (phase === "ready") {
    return (
      <CenteredCard logoUrl={logoUrl}>
        <div className="flex w-full flex-col items-center gap-5 text-center">
          <Spinner />
          <p className="text-lg font-semibold text-gray-900">
            Pronto! Te levando ao seu material...
          </p>
          <ProgressBar percent={100} />
        </div>
      </CenteredCard>
    );
  }

  if (phase === "failed") {
    const message =
      (failReason === null ? undefined : FAIL_MESSAGES[failReason]) ??
      "Não foi possível concluir seu pedido.";
    return (
      <CenteredCard logoUrl={logoUrl}>
        <div className="flex w-full flex-col items-center gap-4 text-center">
          <ErrorIcon />
          <h1 className="text-xl font-semibold text-gray-900">Algo deu errado com seu pedido</h1>
          <p className="text-sm text-gray-500">{message}</p>
          {supportWhatsappUrl ? (
            <a
              href={supportWhatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-semibold text-white"
            >
              Falar com o suporte
            </a>
          ) : null}
          <Link href="/" className="text-sm text-gray-500 underline">
            Voltar ao início
          </Link>
        </div>
      </CenteredCard>
    );
  }

  if (phase === "timeout") {
    return (
      <CenteredCard logoUrl={logoUrl}>
        <div className="flex w-full flex-col items-center gap-4 text-center">
          <ClockIcon />
          <h1 className="text-xl font-semibold text-gray-900">
            Estamos demorando mais que o normal
          </h1>
          <p className="text-sm text-gray-500">
            Não se preocupe — enviamos um link pelo seu WhatsApp e email. Você pode fechar esta
            página.
          </p>
          {resent ? (
            <p className="text-sm font-medium text-green-600" role="status">
              Link reenviado! Verifique seu WhatsApp e email.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={resending}
              className="w-full rounded-lg bg-gray-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
            >
              {resending ? "Reenviando..." : "Reenviar link"}
            </button>
          )}
        </div>
      </CenteredCard>
    );
  }

  // phase === "pending"
  return (
    <CenteredCard logoUrl={logoUrl}>
      <div className="flex w-full flex-col items-center gap-5 text-center">
        <Spinner />
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-gray-900">Liberando seu acesso...</p>
          <p className="text-sm text-gray-500" role="status">
            {getRotatingSubtext(elapsed)}
          </p>
        </div>
        <ProgressBar percent={computeProgressBarPercent(elapsed)} />
      </div>
    </CenteredCard>
  );
}
