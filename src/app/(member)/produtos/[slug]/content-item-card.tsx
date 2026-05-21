"use client";

import { useCallback, useState } from "react";

/**
 * Card de um ContentItem na página do produto.
 *
 * Para itens com arquivo (PDF/áudio/vídeo) o botão busca uma signed URL em
 * `/api/content/[id]/signed-url` e abre o arquivo numa nova aba
 * (`window.open` — em mobile abre o leitor de PDF nativo do iOS/Android).
 * Erros aparecem num banner inline no próprio card (sem `alert()`).
 */

type ContentItemType =
  | "PDF"
  | "AUDIO_FILE"
  | "VIDEO_FILE"
  | "VIDEO_EMBED"
  | "EXTERNAL_LINK"
  | "TEXT";

interface Props {
  id: string;
  type: ContentItemType;
  title: string;
  description: string | null;
  externalUrl: string | null;
  textContent: string | null;
}

interface SignedUrlResponse {
  url?: string;
  error?: { code?: string; message?: string };
}

const DOWNLOAD_LABEL: Partial<Record<ContentItemType, string>> = {
  PDF: "Baixar PDF",
  AUDIO_FILE: "Baixar áudio",
  VIDEO_FILE: "Baixar vídeo",
};

const FILE_TYPES = new Set<ContentItemType>(["PDF", "AUDIO_FILE", "VIDEO_FILE"]);

export function ContentItemCard({ id, type, title, description, externalUrl, textContent }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/content/${id}/signed-url`);
      const data = (await res.json()) as SignedUrlResponse;
      if (!res.ok || !data.url) {
        setError(data.error?.message ?? "Não foi possível abrir o arquivo. Tente novamente.");
        return;
      }
      // Nova aba — em mobile abre o leitor de PDF nativo.
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Falha de conexão. Verifique sua internet e tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-gray-900">{title}</span>
          {description ? <span className="mt-0.5 text-sm text-gray-500">{description}</span> : null}
        </div>

        {FILE_TYPES.has(type) ? (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={loading}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Carregando..." : (DOWNLOAD_LABEL[type] ?? "Baixar arquivo")}
          </button>
        ) : null}

        {type === "EXTERNAL_LINK" && externalUrl ? (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Acessar
          </a>
        ) : null}
      </div>

      {type === "TEXT" && textContent ? (
        <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{textContent}</p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
