import { type NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { fileExists, readFile } from "@/lib/storage/local-storage";
import { validateSignedUrl } from "@/lib/storage/signed-urls-hmac";

/**
 * GET /api/files/[token]
 *
 * Serve um arquivo do storage local quando o token HMAC é válido. Toda
 * falha (token inválido, expirado, arquivo sumiu, erro de IO) responde
 * **404** com o mesmo corpo — anti-enumeração: atacante não consegue
 * inferir se um token alguma vez existiu, expirou ou se há um arquivo lá.
 */
function notFound(): NextResponse {
  return new NextResponse("Not Found", { status: 404 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  const result = validateSignedUrl(token);
  if (!result.valid) {
    return notFound();
  }

  if (!(await fileExists(result.fileKey))) {
    return notFound();
  }

  try {
    const file = await readFile(result.fileKey);
    const webStream = Readable.toWeb(file.stream) as ReadableStream<Uint8Array>;
    return new Response(webStream, {
      headers: {
        "content-type": file.contentType,
        "content-length": String(file.sizeBytes),
        "content-disposition": "inline",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return notFound();
  }
}
