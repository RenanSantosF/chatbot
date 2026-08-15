"use client";

import { QrCode, RefreshCw, Unplug } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { apiFetch } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

type Estado = "DESCONECTADO" | "AGUARDANDO_QRCODE" | "CONECTADO";

interface StatusDaEvolution {
  baseUrl: string;
  instance: string;
  estado: Estado;
  qrCode: string | null;
  connectedPhone: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
}

/**
 * De quanto em quanto tempo perguntar se já conectou.
 *
 * A leitura do QR code acontece no celular, e nada avisa esta aba quando
 * ela termina — quem sabe é o servidor, pelo webhook. Cinco segundos é o
 * ponto em que a espera ainda parece imediata sem transformar uma tela
 * aberta e esquecida numa consulta por segundo.
 */
const INTERVALO_MS = 5_000;

/**
 * Conectar o WhatsApp lendo um QR code, sem passar pela Meta.
 *
 * Vale dizer por que a tela insiste nos avisos: este caminho não é
 * homologado pelo WhatsApp. Funciona, custa menos e conecta em dois
 * minutos — e pode ser interrompido pela Meta a qualquer momento, com o
 * número bloqueado junto. Quem escolhe isso precisa escolher sabendo, e
 * esconder o risco atrás de um botão bonito seria vender o problema junto
 * com a solução.
 */
export function ConectarEvolution() {
  const [status, setStatus] = useState<StatusDaEvolution | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [conectando, setConectando] = useState(false);

  /** Relê o estado depois de uma ação de quem está olhando a tela. */
  const carregar = useCallback(async () => {
    const atual = await apiFetch<StatusDaEvolution | null>("/whatsapp/evolution").catch(
      () => null,
    );
    setStatus(atual);
    if (atual?.baseUrl) setBaseUrl((antes) => antes || atual.baseUrl);
  }, []);

  useEffect(() => {
    // A busca fica escrita aqui, e não numa chamada a `carregar`, porque o
    // estado precisa mudar DENTRO da resposta da promessa — mudá-lo no
    // corpo do efeito faria a tela renderizar duas vezes a cada montagem.
    apiFetch<StatusDaEvolution | null>("/whatsapp/evolution")
      .then((atual) => {
        setStatus(atual);
        if (atual?.baseUrl) setBaseUrl((antes) => antes || atual.baseUrl);
      })
      // Silêncio de propósito: esta é a tela de quem AINDA não conectou, e
      // um erro vermelho na primeira visita assusta sem informar nada.
      .catch(() => undefined)
      .finally(() => setCarregando(false));
  }, []);

  // A espera pela leitura do QR code é a única hora em que vale perguntar
  // ao servidor de tempos em tempos: fora dela, o estado só muda por ação
  // de quem está olhando a tela.
  useEffect(() => {
    if (status?.estado !== "AGUARDANDO_QRCODE") return;

    const timer = setInterval(() => {
      void apiFetch<{ estado: Estado }>("/whatsapp/evolution/conferir")
        .then((resultado) => {
          if (resultado.estado === "CONECTADO") {
            toast.success("WhatsApp conectado.");
          }
          return carregar();
        })
        .catch(() => {
          /* Oscilação de rede não precisa virar aviso na tela. */
        });
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [status?.estado, carregar]);

  async function conectar(evento: React.FormEvent) {
    evento.preventDefault();
    setConectando(true);
    try {
      await apiFetch("/whatsapp/evolution", {
        method: "POST",
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      });
      setApiKey("");
      await carregar();
    } catch (erro) {
      toast.error(
        erro instanceof ApiError ? erro.message : "Não deu pra conectar ao servidor.",
      );
    } finally {
      setConectando(false);
    }
  }

  async function novoQrCode() {
    try {
      await apiFetch("/whatsapp/evolution/qrcode", { method: "POST" });
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra gerar o QR code.");
    }
  }

  async function desconectar() {
    try {
      await apiFetch("/whatsapp/evolution", { method: "DELETE" });
      await carregar();
      toast.success("WhatsApp desconectado. A empresa voltou para o canal oficial.");
    } catch (erro) {
      toast.error(erro instanceof ApiError ? erro.message : "Não deu pra desconectar.");
    }
  }

  if (carregando) return null;

  const conectado = status?.estado === "CONECTADO";
  const aguardando = status?.estado === "AGUARDANDO_QRCODE";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="size-4" />
          Conectar lendo um QR code
        </CardTitle>
        <CardDescription className="text-pretty">
          Liga o WhatsApp a um servidor Evolution seu, como um aparelho vinculado — o mesmo jeito do
          WhatsApp Web. Conecta em minutos, sem análise da Meta e sem custo por mensagem.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground text-pretty">
          <p className="font-medium text-foreground">Antes de escolher este caminho</p>
          <p className="mt-1">
            Não é homologado pelo WhatsApp. O número pode ser bloqueado, a sessão cai sozinha de vez
            em quando (basta ler o QR code de novo) e não existe modelo aprovado — ou seja, só dá
            para escrever a quem falou com você antes. Para volume alto ou número principal da
            empresa, o caminho oficial continua sendo o mais seguro.
          </p>
        </div>

        {conectado ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                Conectado{status?.connectedPhone ? ` · ${status.connectedPhone}` : ""}
              </span>
              <span className="block text-xs text-muted-foreground">
                As mensagens desta empresa saem por este aparelho.
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void desconectar()}>
              <Unplug className="size-4" />
              Desconectar
            </Button>
          </div>
        ) : null}

        {aguardando ? (
          <div className="flex flex-col items-center gap-3 rounded-md border p-4">
            {status?.qrCode ? (
              <Image
                src={status.qrCode}
                alt="QR code para conectar o WhatsApp"
                width={240}
                height={240}
                unoptimized
                className="rounded-md bg-white p-2"
              />
            ) : (
              <Spinner />
            )}
            <p className="text-center text-xs text-muted-foreground text-pretty">
              No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. O código expira em
              cerca de um minuto.
            </p>
            <Button variant="outline" size="sm" onClick={() => void novoQrCode()}>
              <RefreshCw className="size-4" />
              Gerar outro código
            </Button>
          </div>
        ) : null}

        {status?.lastError ? (
          <p className="text-xs text-destructive text-pretty">{status.lastError}</p>
        ) : null}

        {!conectado ? (
          <form className="flex flex-col gap-3" onSubmit={(e) => void conectar(e)}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="evolution-url">Endereço do servidor</Label>
              <Input
                id="evolution-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://evolution.suaempresa.com"
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="evolution-key">Chave da API</Label>
              <Input
                id="evolution-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="A chave global do seu servidor Evolution"
                required
              />
              <p className="text-xs text-muted-foreground">
                Guardada cifrada. É a mesma chave que você usa no painel do servidor.
              </p>
            </div>
            <Button type="submit" disabled={conectando} className="self-start">
              {conectando ? <Spinner className="size-4" /> : <QrCode className="size-4" />}
              {aguardando ? "Reconectar" : "Conectar"}
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
