"use client";

import { type FormEvent, useState } from "react";
import { Button } from "@/components/admin/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/admin/ui/card";
import { Input } from "@/components/admin/ui/input";
import { Label } from "@/components/admin/ui/label";
import { cn } from "@/lib/utils";

/**
 * Formulário de login do admin. Chama `POST /api/admin/auth/request` e mostra
 * sempre a mesma mensagem genérica (anti-enumeração) — o link real chega por
 * email (Fase 1.6) ou, em dev, no console do servidor.
 */
interface RequestResponse {
  message?: string;
  error?: string;
}

export function AdminLoginForm({ errorMessage }: { errorMessage: string | null }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: "info" | "error" } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as RequestResponse;
      if (res.ok) {
        setFeedback({
          text: data.message ?? "Se este email for de um administrador, o link foi enviado.",
          tone: "info",
        });
      } else {
        setFeedback({
          text: data.error ?? "Não foi possível enviar o link. Tente novamente.",
          tone: "error",
        });
      }
    } catch {
      setFeedback({ text: "Falha de conexão. Tente novamente.", tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Painel administrativo</CardTitle>
        <CardDescription>Acesse com seu email de administrador.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {errorMessage ? (
          <p
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {errorMessage}
          </p>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              disabled={loading}
            />
          </div>
          <Button type="submit" disabled={loading || email.trim().length === 0}>
            {loading ? "Enviando..." : "Enviar link de acesso"}
          </Button>
        </form>

        {feedback ? (
          <p
            className={cn(
              "text-sm",
              feedback.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
            role="status"
          >
            {feedback.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
