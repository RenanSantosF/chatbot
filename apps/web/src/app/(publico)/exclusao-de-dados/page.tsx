import type { Metadata } from "next";
import {
  DocumentoLegal,
  Identificacao,
  Lista,
  Secao,
} from "@/components/publico/documento-legal";
import { EMPRESA, SITE_NAME } from "@/lib/site";

/**
 * A "URL de instruções para exclusão de dados" que a Meta exige.
 *
 * O cadastro do app pede um endereço onde a pessoa descubra como apagar os
 * dados dela. A Meta aceita duas formas: um endpoint que recebe uma
 * requisição assinada e responde em JSON, ou uma PÁGINA explicando o
 * caminho. A segunda é o que faz sentido aqui — quem usa o produto não é
 * quem tem conta no Facebook, e não existe "login com Facebook" pra
 * desfazer. O que existe é uma empresa cliente com dados dos clientes dela.
 *
 * Por isso a página é honesta sobre a cadeia: na maior parte dos casos quem
 * apaga é a empresa contratante, dentro do painel, porque é ela a
 * controladora dos dados (ver a política de privacidade). O nosso papel é
 * dar a ferramenta e atender quem não conseguir chegar nela.
 */
export const metadata: Metadata = {
  title: "Exclusão de dados",
  description: `Como pedir a exclusão dos dados tratados pela ${SITE_NAME}, seja você uma empresa cliente ou alguém que conversou com uma delas pelo WhatsApp.`,
  openGraph: {
    type: "article",
    locale: "pt_BR",
    url: "/exclusao-de-dados",
    title: `Exclusão de dados — ${SITE_NAME}`,
  },
  alternates: { canonical: "/exclusao-de-dados" },
};

export default function ExclusaoDeDados() {
  return (
    <DocumentoLegal
      titulo="Exclusão de dados"
      atualizadoEm="15 de agosto de 2026"
      resumo="Como apagar os dados, e quem apaga o quê. O caminho muda conforme você seja a empresa que contratou o serviço ou alguém que conversou com uma delas."
    >
      <Secao titulo="Se você é a empresa que contratou">
        <p>
          Você é a controladora dos dados dos seus clientes, e o painel tem as ferramentas
          para agir sobre eles a qualquer momento, sem pedir nada a ninguém:
        </p>
        <Lista
          itens={[
            "Apagar uma conversa ou um cliente específico, pela ficha dele.",
            "Definir por quanto tempo mensagens e anexos são guardados, em Configurações › Armazenamento — o que estiver fora do prazo é apagado sozinho.",
            "Encerrar a conta inteira, em Configurações › Conta. Vão junto as conversas, os clientes, os anexos guardados e os acessos de todo mundo.",
          ]}
        />
        <p>
          Encerrar a conta é coisa do dono, e o painel confirma duas vezes antes: pede a
          senha e o nome da empresa digitado à mão. Não tem como voltar atrás — não
          guardamos cópia pra restaurar. Se você não conseguir chegar na tela, peça pelo
          canal de contato abaixo a partir do e-mail do dono da conta; confirmamos a
          identidade antes de executar, porque um pedido de exclusão feito por quem não
          deveria é irreversível.
        </p>
      </Secao>

      <Secao titulo="Se você conversou com uma empresa pelo WhatsApp">
        <p>
          Suas mensagens ficam guardadas em nome da <strong>empresa com quem você
          falou</strong> — é ela quem decide o que fazer com elas, e é a ela que o pedido
          deve ser dirigido. Fale com essa empresa pelo mesmo WhatsApp em que vocês
          conversaram e peça a exclusão dos seus dados.
        </p>
        <p>
          Se você não conseguir contato com ela, escreva para nós pelo endereço abaixo
          dizendo qual é a empresa e qual o telefone usado na conversa. Encaminhamos o
          pedido e, se ela não responder no prazo da lei, agimos como operadores para
          atendê-lo.
        </p>
      </Secao>

      <Secao titulo="Prazo">
        <p>
          Pedidos são atendidos em até 15 dias. A exclusão é definitiva: não mantemos cópia
          das conversas apagadas, e as cópias de segurança que ainda contiverem o dado são
          descartadas no ciclo seguinte de rotação, em no máximo 30 dias.
        </p>
        <p>
          Continuam guardados apenas os registros que a lei nos obriga a manter, como
          dados fiscais de cobrança — e esses não incluem o conteúdo das conversas.
        </p>
      </Secao>

      <Secao titulo="Como pedir">
        {EMPRESA.email ? (
          <p>
            Envie o pedido para{" "}
            <a
              href={`mailto:${EMPRESA.email}?subject=Exclus%C3%A3o%20de%20dados`}
              className="underline underline-offset-4"
            >
              {EMPRESA.email}
            </a>{" "}
            com o assunto &ldquo;Exclusão de dados&rdquo;. Responderemos confirmando o
            recebimento e, depois, a conclusão.
          </p>
        ) : (
          <p>
            Envie o pedido para o e-mail de contato da empresa, com o assunto
            &ldquo;Exclusão de dados&rdquo;. Responderemos confirmando o recebimento e,
            depois, a conclusão.
          </p>
        )}
      </Secao>

      <Identificacao />
    </DocumentoLegal>
  );
}
