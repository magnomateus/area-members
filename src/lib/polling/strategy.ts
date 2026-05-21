/**
 * Estratégia de polling da página `/obrigado`. Funções puras — toda a lógica
 * "temporal" do polling vive aqui, separada do componente React, para ser
 * testável sem renderizar UI.
 */

/** Intervalo de polling em ms: 2s (0-30s), 3s (30-60s), 5s (60s+). */
export function computePollingInterval(elapsedSeconds: number): number {
  if (elapsedSeconds < 30) return 2000;
  if (elapsedSeconds < 60) return 3000;
  return 5000;
}

/**
 * Percentual (0-90) da barra de progresso conforme o tempo decorrido.
 *
 * ⚠️ PURAMENTE VISUAL / PSICOLÓGICO. NÃO reflete o progresso real do
 * provisionamento — é só feedback de UX. NÃO sincronizar com o status real.
 * Curva: 0-3s → 0-30% (rápido, "começou já"); 3-13s → 30-70% (médio);
 * 13-28s → 70-90% (lento); 28s+ → trava em 90% até o status virar 'ready'.
 */
export function computeProgressBarPercent(elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  if (elapsedSeconds < 3) return (elapsedSeconds / 3) * 30;
  if (elapsedSeconds < 13) return 30 + ((elapsedSeconds - 3) / 10) * 40;
  if (elapsedSeconds < 28) return 70 + ((elapsedSeconds - 13) / 15) * 20;
  return 90;
}

const ROTATING_SUBTEXTS = [
  "Confirmando seu pagamento...",
  "Preparando seu material...",
  "Quase lá...",
] as const;

/** Subtexto rotativo — troca a cada 5s, ciclando as 3 mensagens. */
export function getRotatingSubtext(elapsedSeconds: number): string {
  const slot = Math.floor(Math.max(0, elapsedSeconds) / 5);
  return ROTATING_SUBTEXTS[slot % ROTATING_SUBTEXTS.length];
}
