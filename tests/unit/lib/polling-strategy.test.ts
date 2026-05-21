import { describe, expect, it } from "vitest";
import {
  computePollingInterval,
  computeProgressBarPercent,
  getRotatingSubtext,
} from "@/lib/polling/strategy";

describe("computePollingInterval", () => {
  it("2s nos primeiros 30s", () => {
    expect(computePollingInterval(0)).toBe(2000);
    expect(computePollingInterval(29)).toBe(2000);
  });
  it("3s entre 30s e 60s", () => {
    expect(computePollingInterval(30)).toBe(3000);
    expect(computePollingInterval(59)).toBe(3000);
  });
  it("5s a partir de 60s", () => {
    expect(computePollingInterval(60)).toBe(5000);
    expect(computePollingInterval(200)).toBe(5000);
  });
});

describe("computeProgressBarPercent", () => {
  it("0% no início", () => {
    expect(computeProgressBarPercent(0)).toBe(0);
  });
  it("30% aos 3s", () => {
    expect(computeProgressBarPercent(3)).toBe(30);
  });
  it("70% aos 13s", () => {
    expect(computeProgressBarPercent(13)).toBe(70);
  });
  it("90% aos 28s e trava em 90% depois", () => {
    expect(computeProgressBarPercent(28)).toBe(90);
    expect(computeProgressBarPercent(120)).toBe(90);
  });
  it("é monotonicamente crescente e nunca passa de 90", () => {
    let prev = -1;
    for (let s = 0; s <= 50; s += 1) {
      const percent = computeProgressBarPercent(s);
      expect(percent).toBeGreaterThanOrEqual(prev);
      expect(percent).toBeLessThanOrEqual(90);
      prev = percent;
    }
  });
});

describe("getRotatingSubtext", () => {
  it("mantém o mesmo texto dentro de uma janela de 5s", () => {
    expect(getRotatingSubtext(0)).toBe(getRotatingSubtext(4));
  });
  it("troca de texto a cada 5s", () => {
    expect(getRotatingSubtext(0)).not.toBe(getRotatingSubtext(5));
    expect(getRotatingSubtext(5)).not.toBe(getRotatingSubtext(10));
  });
  it("cicla de volta ao 1º texto após 3 janelas (15s)", () => {
    expect(getRotatingSubtext(15)).toBe(getRotatingSubtext(0));
  });
  it("sempre retorna uma string não-vazia", () => {
    for (let s = 0; s < 40; s += 1) {
      expect(getRotatingSubtext(s).length).toBeGreaterThan(0);
    }
  });
});
