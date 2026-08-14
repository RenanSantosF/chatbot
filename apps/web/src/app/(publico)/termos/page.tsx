import type { Metadata } from "next";
import {
  Atencao,
  DocumentoLegal,
  Lista,
  Secao,
} from "@/components/publico/documento-legal";

export const metadata: Metadata = {
  // Sem "— Clara" no fim: o layout raiz já acrescenta a marca pelo
  // template de título, e repetir aqui produziria "Termos de uso — Clara ·
  // Clara" na aba e no resultado de busca.
  title: "Termos de uso",
  alternates: { canonical: "/termos" },
  // Card próprio: sem isto o link destes documentos compartilhado
  // num grupo aparecia com a chamada de venda da home.
  openGraph: { type: "article", locale: "pt_BR", url: "/termos", title: "Termos de uso — Clara" },
  description:
    "Condições de uso da Clara, incluindo os custos cobrados por terceiros (Meta e provedor de IA) que não passam por nós.",
};

export default function TermosPage() {
  return (
    <DocumentoLegal
      titulo="Termos de uso"
      atualizadoEm="14 de agosto de 2026"
      resumo="Clara é um painel de atendimento que conecta o WhatsApp da sua empresa a uma inteligência artificial. Este documento diz o que fazemos, o que não fazemos, e quanto custa o que não é cobrado por nós."
    >
      <Secao titulo="O que a Clara é">
        <p>
          A Clara recebe as mensagens que chegam no WhatsApp da sua empresa, deixa uma
          inteligência artificial responder o que ela conseguir, e passa para uma pessoa da
          sua equipe quando o assunto exigir. Tudo isso acontece num painel único, com
          histórico, filas de atendimento e relatórios.
        </p>
        <p>
          A Clara é uma <strong>ferramenta</strong>. As respostas enviadas ao seu cliente
          saem do número da sua empresa e são de responsabilidade dela — inclusive as que a
          IA escrever. Continue lendo: a seção sobre a IA explica por que isso importa.
        </p>
      </Secao>

      <Secao titulo="Custos que não são nossos">
        <p>
          Além do que você paga pela Clara, existem dois custos cobrados{" "}
          <strong>diretamente por terceiros</strong>, na conta que está no seu nome. Nós não
          intermediamos, não marcamos preço e não temos como alterá-los.
        </p>

        <Atencao>
          <strong>Meta (WhatsApp).</strong> A Meta cobra por conversa iniciada, com preço
          que varia conforme o tipo (atendimento, marketing, utilidade, autenticação) e o
          país do cliente. Ela mantém uma cota mensal de conversas de atendimento sem custo
          e reajusta a tabela periodicamente. O valor é cobrado da conta comercial da sua
          empresa na Meta, com o meio de pagamento que você cadastrou lá.
        </Atencao>

        <Atencao>
          <strong>Provedor de inteligência artificial.</strong> A chave de API é sua e o
          consumo é cobrado por quem fornece o modelo (hoje, o Google Gemini), medido por
          quantidade de texto processado. Conversa longa custa mais que conversa curta, e
          base de conhecimento grande aumenta o custo de cada resposta.
        </Atencao>

        <p>
          Os dois provedores publicam as tabelas vigentes em seus próprios sites, e é lá que
          o preço do dia deve ser conferido. Nós não reproduzimos valores aqui de propósito:
          um número desatualizado num documento como este é pior que número nenhum.
        </p>
      </Secao>

      <Secao titulo="Sobre as respostas da inteligência artificial">
        <p>
          A IA responde a partir do que você configurar: instruções, documentos da base de
          conhecimento e o histórico da conversa. Ela erra. Todo modelo de linguagem erra —
          pode afirmar com segurança algo que não é verdade, e não existe configuração que
          elimine isso.
        </p>
        <Lista
          itens={[
            <>
              Revise o que a IA está autorizada a dizer, sobretudo <strong>preço, prazo e
              condição contratual</strong>.
            </>,
            <>
              Use as regras de escalonamento para que assuntos sensíveis cheguem sempre a uma
              pessoa.
            </>,
            <>
              A Clara não se responsabiliza por compromisso assumido pela IA em nome da sua
              empresa. Quem responde pelo número é quem é dono dele.
            </>,
          ]}
        />
      </Secao>

      <Secao titulo="Suas obrigações">
        <Lista
          itens={[
            <>
              Usar um número de WhatsApp que sua empresa tenha direito de usar, seguindo as
              políticas da Meta.
            </>,
            <>
              Não enviar mensagem não solicitada. Denúncia de spam derruba a qualidade do seu
              número e pode fazer a Meta bloqueá-lo — e esse bloqueio é da conta, não da Clara.
            </>,
            <>
              Manter suas credenciais em segurança, e as de cada pessoa da sua equipe. Cada
              acesso é individual e as permissões são configuráveis por papel.
            </>,
            <>
              Cumprir a LGPD em relação aos dados dos seus clientes. Você é o controlador
              desses dados; nós somos operador (ver a Política de Privacidade).
            </>,
          ]}
        />
      </Secao>

      <Secao titulo="Disponibilidade">
        <p>
          Trabalhamos para manter o serviço no ar, mas ele depende de terceiros — a API da
          Meta, o provedor de IA, a infraestrutura de nuvem. Uma instabilidade em qualquer um
          deles afeta a Clara, e não temos controle sobre isso. Não há garantia contratual de
          disponibilidade ininterrupta.
        </p>
        <p>
          Quando o WhatsApp está fora do ar, as mensagens ficam retidas na Meta e chegam
          quando o serviço volta. Nenhuma mensagem é descartada por nós.
        </p>
      </Secao>

      <Secao titulo="Encerramento">
        <p>
          Você pode encerrar quando quiser. Ao encerrar, seus dados ficam disponíveis para
          exportação por 30 dias e depois são apagados definitivamente, incluindo os anexos
          guardados. Desconectar o WhatsApp não apaga nada por si só — é preciso pedir a
          exclusão.
        </p>
        <p>
          Podemos suspender uma conta que esteja sendo usada para envio de spam, fraude ou
          qualquer prática que coloque em risco o acesso das demais empresas à API da Meta.
        </p>
      </Secao>

      <Secao titulo="Mudanças neste documento">
        <p>
          Se estes termos mudarem de forma relevante, avisaremos pelo painel antes de a
          alteração passar a valer. A data no topo indica a versão vigente.
        </p>
      </Secao>
    </DocumentoLegal>
  );
}
