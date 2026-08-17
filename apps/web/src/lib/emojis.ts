/**
 * O catálogo de emojis do compositor.
 *
 * Havia trinta aqui, escolhidos a dedo, com o argumento de que quem
 * atende usa sempre os mesmos vinte. O argumento está certo sobre a
 * FREQUÊNCIA e errado sobre a necessidade: o emoji que falta é sempre o
 * que a conversa pediu — a comida do restaurante, o carro da oficina, o
 * cachorro do pet shop —, e não ter saída nenhuma pra ele fazia o
 * atendente sair do painel pra copiar de outro lugar.
 *
 * Também não é a lista Unicode inteira. Os ~3.800 emojis do padrão
 * incluem bandeiras de territórios, combinações de tom de pele e famílias
 * de dez pessoas que ninguém manda pra cliente, e uma grade com tudo isso
 * é mais difícil de usar que uma menor: rolar duzentas linhas atrás de um
 * polegar é pior que ter dez à vista.
 *
 * O corte é este: o que aparece numa conversa de trabalho, agrupado como
 * o WhatsApp agrupa, com busca por palavra em português — que é o que
 * resolve o caso do emoji que falta sem obrigar a rolagem.
 */
export interface GrupoDeEmojis {
  titulo: string;
  /** Emoji seguido das palavras que o encontram na busca. */
  itens: { e: string; k: string }[];
}

export const GRUPOS_DE_EMOJIS: GrupoDeEmojis[] = [
  {
    titulo: "Usados no atendimento",
    itens: [
      { e: "👍", k: "joia positivo curtir ok certo polegar" },
      { e: "🙏", k: "obrigado agradeco por favor reza maos" },
      { e: "👌", k: "ok perfeito certo joia" },
      { e: "✅", k: "certo confirmado feito ok check" },
      { e: "❌", k: "errado nao cancelado x" },
      { e: "⚠️", k: "atencao cuidado alerta aviso" },
      { e: "📅", k: "agenda data calendario dia marcar" },
      { e: "⏰", k: "hora horario relogio alarme prazo" },
      { e: "📍", k: "local endereco onde localizacao pin" },
      { e: "📞", k: "telefone ligar ligacao contato" },
      { e: "💬", k: "mensagem conversa falar chat" },
      { e: "📎", k: "anexo arquivo clipe documento" },
      { e: "📄", k: "documento papel arquivo folha" },
      { e: "💰", k: "dinheiro valor preco pagamento saco" },
      { e: "💳", k: "cartao pagamento credito debito" },
      { e: "🧾", k: "recibo nota fiscal comprovante" },
      { e: "🚚", k: "entrega frete caminhao envio" },
      { e: "📦", k: "pacote encomenda caixa pedido" },
      { e: "🎉", k: "parabens comemorar festa" },
      { e: "❤️", k: "amor coracao carinho obrigado" },
    ],
  },
  {
    titulo: "Rostos",
    itens: [
      { e: "😀", k: "feliz sorriso alegre" },
      { e: "😃", k: "feliz sorriso animado" },
      { e: "😄", k: "feliz risada alegre" },
      { e: "😁", k: "sorriso dentes feliz" },
      { e: "😆", k: "risada gargalhada" },
      { e: "😅", k: "alivio suor risada nervoso" },
      { e: "😂", k: "chorando rindo risada engracado" },
      { e: "🤣", k: "rolando rindo gargalhada" },
      { e: "🙂", k: "sorriso leve simpatico" },
      { e: "🙃", k: "de cabeca pra baixo ironia" },
      { e: "😉", k: "piscada" },
      { e: "😊", k: "feliz timido sorriso" },
      { e: "😇", k: "anjo inocente" },
      { e: "😍", k: "amor apaixonado coracao olhos" },
      { e: "🤩", k: "estrelas uau incrivel" },
      { e: "😘", k: "beijo" },
      { e: "😗", k: "beijo assobio" },
      { e: "😋", k: "gostoso delicia lingua" },
      { e: "😛", k: "lingua brincadeira" },
      { e: "🤪", k: "doido maluco" },
      { e: "🤔", k: "pensando duvida hmm" },
      { e: "🤨", k: "desconfiado sobrancelha" },
      { e: "😐", k: "neutro sem expressao" },
      { e: "😑", k: "sem expressao chateado" },
      { e: "🙄", k: "revirando olhos" },
      { e: "😏", k: "malicioso sorrisinho" },
      { e: "😴", k: "dormindo sono" },
      { e: "😪", k: "sono cansado" },
      { e: "😌", k: "aliviado calmo" },
      { e: "😔", k: "triste pensativo" },
      { e: "😢", k: "chorando triste lagrima" },
      { e: "😭", k: "chorando muito triste" },
      { e: "😤", k: "bufando irritado" },
      { e: "😠", k: "bravo irritado raiva" },
      { e: "😡", k: "furioso raiva bravo vermelho" },
      { e: "🤯", k: "explodindo cabeca chocado" },
      { e: "😳", k: "surpreso envergonhado" },
      { e: "😱", k: "assustado grito medo" },
      { e: "😰", k: "ansioso preocupado suor" },
      { e: "🥺", k: "suplicante pidao carinha" },
      { e: "😬", k: "constrangido careta" },
      { e: "🤗", k: "abraco acolher" },
      { e: "🤝", k: "acordo aperto de mao parceria" },
      { e: "😎", k: "oculos legal descolado" },
      { e: "🥳", k: "festa comemorar aniversario" },
      { e: "😷", k: "mascara doente" },
      { e: "🤒", k: "doente febre termometro" },
      { e: "🤧", k: "espirro resfriado" },
    ],
  },
  {
    titulo: "Gestos e pessoas",
    itens: [
      { e: "👋", k: "oi tchau aceno ola" },
      { e: "🤚", k: "mao parar" },
      { e: "✋", k: "mao parar cinco" },
      { e: "👌", k: "ok perfeito" },
      { e: "🤌", k: "dedos italiano" },
      { e: "✌️", k: "paz vitoria dois" },
      { e: "🤞", k: "dedos cruzados torcendo sorte" },
      { e: "🤙", k: "chama liga shaka" },
      { e: "👈", k: "esquerda aponta" },
      { e: "👉", k: "direita aponta" },
      { e: "👆", k: "cima aponta acima" },
      { e: "👇", k: "baixo aponta abaixo" },
      { e: "👍", k: "joia positivo curtir" },
      { e: "👎", k: "negativo nao ruim" },
      { e: "👊", k: "soco toca aqui" },
      { e: "👏", k: "palmas parabens aplausos" },
      { e: "🙌", k: "maos pra cima comemorar" },
      { e: "🙏", k: "obrigado por favor reza" },
      { e: "💪", k: "forca musculo braco" },
      { e: "🧠", k: "cerebro ideia pensar" },
      { e: "👀", k: "olhos olhando ver" },
      { e: "👤", k: "pessoa usuario perfil" },
      { e: "👥", k: "pessoas equipe time" },
      { e: "🧑‍💻", k: "trabalho computador programador" },
      { e: "👨‍🔧", k: "mecanico tecnico conserto" },
      { e: "👩‍⚕️", k: "medica saude enfermeira" },
      { e: "👮", k: "policia" },
      { e: "🕵️", k: "detetive investigar" },
      { e: "💇", k: "cabelo corte salao barbeiro" },
      { e: "💅", k: "unha manicure esmalte" },
    ],
  },
  {
    titulo: "Objetos e trabalho",
    itens: [
      { e: "📱", k: "celular telefone whatsapp" },
      { e: "💻", k: "notebook computador laptop" },
      { e: "🖥️", k: "computador monitor desktop" },
      { e: "⌨️", k: "teclado digitar" },
      { e: "🖨️", k: "impressora imprimir" },
      { e: "📷", k: "camera foto" },
      { e: "🎥", k: "video filmadora gravar" },
      { e: "🎤", k: "microfone audio gravar" },
      { e: "🔊", k: "som alto volume" },
      { e: "🔇", k: "mudo sem som" },
      { e: "🔔", k: "sino aviso notificacao" },
      { e: "📧", k: "email correio mensagem" },
      { e: "📨", k: "email enviado mensagem" },
      { e: "📝", k: "anotar escrever nota" },
      { e: "✏️", k: "lapis escrever editar" },
      { e: "📋", k: "prancheta lista checklist" },
      { e: "📊", k: "grafico relatorio dados barras" },
      { e: "📈", k: "crescimento subiu grafico alta" },
      { e: "📉", k: "queda caiu grafico baixa" },
      { e: "🗂️", k: "pasta arquivo organizar" },
      { e: "📁", k: "pasta arquivo" },
      { e: "🔑", k: "chave senha acesso" },
      { e: "🔒", k: "cadeado seguro trancado" },
      { e: "🔓", k: "aberto destrancado" },
      { e: "🛠️", k: "ferramenta conserto manutencao" },
      { e: "🔧", k: "chave inglesa conserto" },
      { e: "⚙️", k: "engrenagem configuracao ajuste" },
      { e: "🧹", k: "limpeza vassoura faxina" },
      { e: "🛒", k: "carrinho compras mercado" },
      { e: "🏷️", k: "etiqueta preco tag" },
      { e: "💵", k: "dinheiro nota real dolar" },
      { e: "🏦", k: "banco agencia" },
      { e: "🏠", k: "casa residencia" },
      { e: "🏢", k: "predio escritorio empresa" },
      { e: "🏥", k: "hospital clinica saude" },
      { e: "🏫", k: "escola faculdade" },
      { e: "⚖️", k: "justica advogado juridico balanca" },
      { e: "🎓", k: "formatura diploma curso" },
    ],
  },
  {
    titulo: "Transporte e lugares",
    itens: [
      { e: "🚗", k: "carro automovel" },
      { e: "🚕", k: "taxi" },
      { e: "🚙", k: "suv carro" },
      { e: "🚌", k: "onibus" },
      { e: "🏍️", k: "moto motocicleta" },
      { e: "🚲", k: "bicicleta bike" },
      { e: "✈️", k: "aviao voo viagem" },
      { e: "🚢", k: "navio barco" },
      { e: "🗺️", k: "mapa rota" },
      { e: "🧭", k: "bussola direcao" },
      { e: "🚦", k: "semaforo transito" },
      { e: "⛽", k: "posto combustivel gasolina" },
      { e: "🏖️", k: "praia ferias" },
      { e: "🌧️", k: "chuva chuvoso" },
      { e: "☀️", k: "sol ensolarado dia" },
      { e: "🌙", k: "lua noite" },
      { e: "🔥", k: "fogo quente bombando" },
      { e: "⭐", k: "estrela avaliacao favorito" },
      { e: "🌟", k: "brilho destaque estrela" },
      { e: "⚡", k: "raio rapido energia" },
    ],
  },
  {
    titulo: "Comida",
    itens: [
      { e: "🍔", k: "hamburguer lanche" },
      { e: "🍟", k: "batata frita" },
      { e: "🍕", k: "pizza" },
      { e: "🌭", k: "cachorro quente hotdog" },
      { e: "🥪", k: "sanduiche" },
      { e: "🌮", k: "taco mexicano" },
      { e: "🍗", k: "frango coxa" },
      { e: "🥗", k: "salada" },
      { e: "🍝", k: "macarrao massa" },
      { e: "🍣", k: "sushi japones" },
      { e: "🍰", k: "bolo doce fatia" },
      { e: "🎂", k: "bolo aniversario" },
      { e: "🍫", k: "chocolate" },
      { e: "🍦", k: "sorvete" },
      { e: "☕", k: "cafe cafezinho" },
      { e: "🍺", k: "cerveja chopp" },
      { e: "🍷", k: "vinho taca" },
      { e: "🥤", k: "refrigerante bebida copo" },
      { e: "💧", k: "agua gota" },
      { e: "🍎", k: "maca fruta" },
    ],
  },
  {
    titulo: "Símbolos",
    itens: [
      { e: "❤️", k: "coracao amor vermelho" },
      { e: "🧡", k: "coracao laranja" },
      { e: "💛", k: "coracao amarelo" },
      { e: "💚", k: "coracao verde" },
      { e: "💙", k: "coracao azul" },
      { e: "💜", k: "coracao roxo" },
      { e: "🖤", k: "coracao preto" },
      { e: "💔", k: "coracao partido triste" },
      { e: "✨", k: "brilho novo especial" },
      { e: "💯", k: "cem perfeito nota" },
      { e: "🔴", k: "vermelho bolinha urgente" },
      { e: "🟢", k: "verde bolinha ok livre" },
      { e: "🟡", k: "amarelo bolinha atencao" },
      { e: "🔵", k: "azul bolinha" },
      { e: "▶️", k: "play iniciar" },
      { e: "⏸️", k: "pausa pausar" },
      { e: "🔄", k: "atualizar repetir refresh" },
      { e: "➡️", k: "seta direita proximo" },
      { e: "⬅️", k: "seta esquerda voltar" },
      { e: "❓", k: "duvida pergunta interrogacao" },
      { e: "❗", k: "importante exclamacao atencao" },
      { e: "🆗", k: "ok certo" },
      { e: "🆕", k: "novo new" },
      { e: "🚫", k: "proibido nao bloqueado" },
    ],
  },
];

/** Tira acento e caixa: quem digita "coracao" tem que achar "coração". */
function simples(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Os emojis que casam com o que foi digitado.
 *
 * Busca no grupo inteiro, sem seção: procurar é justamente o gesto de
 * quem não sabe em qual categoria a coisa está.
 */
export function buscarEmojis(termo: string): string[] {
  const alvo = simples(termo);
  if (!alvo) return [];

  const achados: string[] = [];
  for (const grupo of GRUPOS_DE_EMOJIS) {
    for (const item of grupo.itens) {
      if (item.k.includes(alvo) && !achados.includes(item.e)) {
        achados.push(item.e);
      }
    }
  }
  return achados;
}
