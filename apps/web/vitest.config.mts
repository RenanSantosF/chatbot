import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Os testes do painel.
 *
 * Começam pela lógica PURA — as funções que decidem o que a tela mostra,
 * sem tocar em DOM. É de propósito: são elas que erram calado (um selo que
 * não aparece, um alarme que dispara na hora errada) e as que sobrevivem a
 * qualquer redesenho. Teste de componente vem depois, quando houver
 * comportamento que só existe montado.
 *
 * Ambiente `node`, e não `jsdom`: nada aqui precisa de janela, e um jsdom
 * carregado por engano deixa a suíte dez vezes mais lenta sem dar nada em
 * troca.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
