"use client";

import { MessageCircle } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { WhatsAppSettings } from "@/lib/types";

interface ConfigDoSignup {
  disponivel: boolean;
  appId: string | null;
  configId: string | null;
  versao: string;
}

/** O que a janela da Meta devolve quando o cliente conclui. */
interface RetornoDaMeta {
  phone_number_id?: string;
  waba_id?: string;
  business_id?: string;
  /** Só nos eventos de erro. */
  error_message?: string;
  current_step?: string;
}

/**
 * O último recado da janela da Meta, seja ele qual for.
 *
 * A janela conversa por `postMessage` e manda três tipos de evento: FINISH
 * (concluiu), CANCEL (a pessoa fechou) e ERROR (deu errado do lado de lá).
 * Guardar o evento, e não só os identificadores, é o que separa "o usuário
 * desistiu" de "a conexão falhou" — sem isso os dois casos são exatamente o
 * mesmo silêncio, e uma janela que abre e fecha sozinha não deixa rastro
 * nenhum pra investigar.
 */
interface EventoDaMeta {
  event?: string;
  data?: RetornoDaMeta;
}

declare global {
  interface Window {
    FB?: {
      init: (opcoes: Record<string, unknown>) => void;
      login: (
        retorno: (resposta: { authResponse?: { code?: string } }) => void,
        opcoes: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

/**
 * Traduz o fim malsucedido numa frase que diz o que fazer.
 *
 * O caso que motivou isto: a janela abria, piscava e fechava sozinha, sem
 * mensagem em lugar nenhum — e o código tratava isso como "o usuário
 * desistiu", que é o desfecho normal. Sem distinguir os dois, o defeito
 * mais comum de configuração fica invisível justamente pra quem está
 * configurando.
 *
 * A janela fechar ANTES de mandar qualquer evento é o sintoma clássico de
 * o domínio não estar liberado no app da Meta: o Facebook recusa a abertura
 * e fecha na hora, sem chegar a desenhar tela nenhuma.
 */
function porQueNaoConectou(
  ultimo: EventoDaMeta | null,
  code?: string,
): string {
  if (ultimo?.event === "ERROR") {
    return (
      ultimo.data?.error_message ??
      "A Meta recusou a conexão. Tente de novo em alguns instantes."
    );
  }

  if (ultimo?.event === "CANCEL") {
    const passo = ultimo.data?.current_step;
    return passo
      ? `Conexão interrompida em "${passo}". Você pode recomeçar quando quiser.`
      : "Conexão interrompida. Você pode recomeçar quando quiser.";
  }

  // Autorizou (veio código) mas os identificadores não chegaram: a janela
  // terminou sem anunciar a conta.
  if (code) {
    return "A autorização passou, mas a Meta não informou qual número foi conectado. Tente de novo.";
  }

  return (
    "A janela do Facebook fechou sem responder. Isso costuma ser o domínio " +
    "deste site não estar liberado no app da Meta — confira o domínio em " +
    "Configurações do app e nos domínios permitidos do Login para Empresas."
  );
}

/**
 * Conecta o WhatsApp do cliente em um clique.
 *
 * Ele autoriza numa janela do próprio Facebook e nunca abre o Meta
 * Developers. De lá vêm duas coisas por caminhos diferentes, e as duas são
 * necessárias: um evento de mensagem traz os identificadores da conta, e o
 * retorno do login traz o código de autorização. Por isso os dois ficam
 * guardados aqui até o par estar completo.
 */
export function ConectarWhatsApp({
  onConectado,
}: {
  onConectado: (settings: WhatsAppSettings) => void;
}) {
  const [config, setConfig] = useState<ConfigDoSignup | null>(null);
  const [sdkPronto, setSdkPronto] = useState(false);
  const [conectando, setConectando] = useState(false);
  const identificadores = useRef<RetornoDaMeta | null>(null);
  const ultimoEvento = useRef<EventoDaMeta | null>(null);

  useEffect(() => {
    apiFetch<ConfigDoSignup>("/whatsapp/embedded-signup/config")
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  useEffect(() => {
    function ouvir(evento: MessageEvent) {
      // Só aceita recado vindo do Facebook: sem esta checagem qualquer
      // página aberta em outra aba poderia forjar uma conexão.
      if (!evento.origin.endsWith("facebook.com")) return;
      try {
        const dados = JSON.parse(String(evento.data)) as {
          type?: string;
          event?: string;
          data?: RetornoDaMeta;
        };
        if (dados.type !== "WA_EMBEDDED_SIGNUP") return;
        ultimoEvento.current = { event: dados.event, data: dados.data };
        if (dados.data?.phone_number_id) identificadores.current = dados.data;
      } catch {
        // A Meta manda outras mensagens nesse canal que não são JSON.
      }
    }

    addEventListener("message", ouvir);
    return () => removeEventListener("message", ouvir);
  }, []);

  async function conectar() {
    if (!window.FB || !config?.configId) return;
    identificadores.current = null;
    // Zerado junto: um erro da tentativa anterior explicaria errado a
    // desistência desta.
    ultimoEvento.current = null;
    setConectando(true);

    window.FB.login(
      (resposta) => {
        const code = resposta.authResponse?.code;
        const ids = identificadores.current;

        if (!code || !ids?.waba_id || !ids.phone_number_id) {
          setConectando(false);
          toast.error(porQueNaoConectou(ultimoEvento.current, code));
          return;
        }

        apiFetch<WhatsAppSettings>("/whatsapp/embedded-signup", {
          method: "POST",
          body: JSON.stringify({
            code,
            wabaId: ids.waba_id,
            phoneNumberId: ids.phone_number_id,
            businessId: ids.business_id,
          }),
        })
          .then((settings) => {
            toast.success("WhatsApp conectado.");
            onConectado(settings);
          })
          .catch((erro) =>
            toast.error(
              erro instanceof ApiError ? erro.message : "Não deu pra conectar.",
            ),
          )
          .finally(() => setConectando(false));
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {} },
      },
    );
  }

  if (!config?.disponivel) return null;

  return (
    <>
      <Script
        src="https://connect.facebook.net/pt_BR/sdk.js"
        strategy="lazyOnload"
        onLoad={() => {
          window.FB?.init({
            appId: config.appId,
            autoLogAppEvents: true,
            xfbml: true,
            version: config.versao,
          });
          setSdkPronto(true);
        }}
      />
      <Button onClick={() => void conectar()} disabled={!sdkPronto || conectando}>
        {conectando ? <Spinner /> : <MessageCircle className="size-4" />}
        Conectar WhatsApp
      </Button>
    </>
  );
}
