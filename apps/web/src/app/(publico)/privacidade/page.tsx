import type { Metadata } from "next";
import {
  Atencao,
  DocumentoLegal,
  Lista,
  Secao,
} from "@/components/publico/documento-legal";

export const metadata: Metadata = {
  title: "Política de privacidade",
  alternates: { canonical: "/privacidade" },
  // Card próprio: sem isto o link destes documentos compartilhado
  // num grupo aparecia com a chamada de venda da home.
  openGraph: { type: "article", locale: "pt_BR", url: "/privacidade", title: "Política de privacidade — Clara" },
  description:
    "Que dados a Clara trata, onde eles ficam, por quanto tempo e com quem são compartilhados.",
};

export default function PrivacidadePage() {
  return (
    <DocumentoLegal
      titulo="Política de privacidade"
      atualizadoEm="14 de agosto de 2026"
      resumo="Que dados a Clara trata, onde eles ficam guardados, por quanto tempo e quem mais tem acesso a eles."
    >
      <Secao titulo="Quem é quem, na linguagem da LGPD">
        <p>
          A <strong>empresa que contrata a Clara é a controladora</strong> dos dados dos
          próprios clientes: é ela que decide o que coletar e por quê. A{" "}
          <strong>Clara é operadora</strong>: trata esses dados seguindo a instrução da
          empresa contratante, e não os usa para finalidade própria.
        </p>
        <p>
          Na prática: se um cliente seu pedir para ser esquecido, o pedido é seu para
          atender, e a Clara oferece as ferramentas para isso.
        </p>
      </Secao>

      <Secao titulo="O que é tratado">
        <Lista
          itens={[
            <>
              <strong>Conversas do WhatsApp</strong> — texto, imagem, áudio, vídeo,
              documento e localização enviados entre a empresa e o cliente dela.
            </>,
            <>
              <strong>Cadastro dos clientes</strong> — telefone, nome do perfil do WhatsApp
              e o que a empresa configurar para a IA coletar (e-mail, documento, e afins).
            </>,
            <>
              <strong>Contas de acesso</strong> — nome, e-mail e senha (guardada com hash,
              nunca em texto legível) de quem usa o painel.
            </>,
            <>
              <strong>Credenciais de integração</strong> — token do WhatsApp e chave da IA,
              guardados criptografados com AES-256-GCM. Nunca trafegam para o navegador.
            </>,
          ]}
        />
      </Secao>

      <Secao titulo="Onde ficam">
        <p>
          O banco de dados e a aplicação rodam em infraestrutura de nuvem contratada por
          nós. Os anexos das conversas ficam em armazenamento de objetos próprio, separados
          por empresa, e nunca são públicos: o painel os entrega por endereço autenticado, e
          quem não está logado na empresa certa não abre.
        </p>

        <Atencao>
          <strong>Os anexos ficam em servidores nos Estados Unidos.</strong> A LGPD permite
          a transferência internacional, e ela é o padrão de quase todo serviço de nuvem —
          mas você precisa saber disso, e informar seus clientes se o seu setor exigir.
        </Atencao>

        <p>
          Guardamos cópia dos anexos por um motivo concreto: a Meta apaga a mídia depois de
          30 dias. Sem essa cópia, um documento enviado pelo cliente hoje simplesmente não
          abriria no mês que vem.
        </p>
      </Secao>

      <Secao titulo="Por quanto tempo">
        <p>
          O prazo de retenção é configurável pela empresa contratante, no próprio painel. O
          padrão guarda o histórico enquanto a conta existir, porque histórico de
          atendimento costuma ser necessário justamente quando alguém reclama de algo antigo.
        </p>
        <p>
          Encerrada a conta, os dados ficam disponíveis para exportação por 30 dias e são
          apagados em seguida — banco e anexos.
        </p>
      </Secao>

      <Secao titulo="Com quem é compartilhado">
        <p>Só com quem é indispensável para o serviço funcionar:</p>
        <Lista
          itens={[
            <>
              <strong>Meta (WhatsApp)</strong> — recebe e entrega as mensagens. É o canal;
              sem ela não há conversa.
            </>,
            <>
              <strong>Provedor de IA</strong> — recebe o conteúdo da conversa para gerar a
              resposta. Se a empresa não quiser isso, basta desligar a IA: o painel continua
              funcionando com atendimento humano.
            </>,
            <>
              <strong>Infraestrutura de nuvem</strong> — hospeda a aplicação, o banco e os
              anexos.
            </>,
          ]}
        />
        <p>
          Não vendemos dados, não os usamos para publicidade e não os usamos para treinar
          modelo de inteligência artificial.
        </p>
      </Secao>

      <Secao titulo="Segurança">
        <Lista
          itens={[
            <>Isolamento entre empresas aplicado no banco, em toda consulta.</>,
            <>Credenciais de integração criptografadas com AES-256-GCM.</>,
            <>Senhas guardadas com hash; ninguém as recupera, nem nós.</>,
            <>Limite de tentativas de acesso, contra teste automatizado de senha.</>,
            <>Permissões por papel: cada pessoa vê e faz apenas o que lhe cabe.</>,
            <>Assinatura verificada em todo webhook recebido da Meta.</>,
          ]}
        />
      </Secao>

      <Secao titulo="Direitos do titular">
        <p>
          Quem tem dados tratados aqui pode pedir acesso, correção, exclusão, portabilidade
          e informação sobre compartilhamento. O pedido deve ser feito à{" "}
          <strong>empresa que atende essa pessoa</strong> — é ela a controladora. A Clara
          oferece as ferramentas de exportação e exclusão para que ela cumpra o prazo legal.
        </p>
      </Secao>

      <Secao titulo="Contato">
        <p>
          Dúvidas sobre esta política, ou sobre tratamento de dados na Clara, podem ser
          enviadas ao encarregado de dados da empresa contratante. Para questões sobre a
          própria plataforma, fale com quem administra a conta da sua empresa.
        </p>
      </Secao>
    </DocumentoLegal>
  );
}
