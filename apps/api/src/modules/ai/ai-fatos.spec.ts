import { fatosSemLastro, podarFatosSemLastro } from './ai-fatos';

/**
 * O caso real, e as bordas que decidem se a trava serve ou atrapalha.
 *
 * Uma trava dessas erra de dois jeitos, e os dois custam caro: deixar
 * passar um endereço inventado (o cliente vai ao lugar errado) ou barrar
 * uma resposta correta (o atendimento para de funcionar sozinho e vira
 * fila de gente). Os testes abaixo cobrem os dois lados.
 */

const NADA = '';

describe('endereço', () => {
  it('barra o endereço que a IA inventou — o caso que originou a trava', () => {
    const achados = fatosSemLastro(
      'O nosso escritório fica na Avenida Paulista, nº 1000, Bela Vista - São Paulo/SP.',
      'Somos um escritório de advocacia. Atendemos de segunda a sexta das 08h às 17h.',
    );

    expect(achados).toHaveLength(1);
    expect(achados[0].tipo).toBe('endereço');
  });

  it('deixa passar o endereço que está na base de conhecimento', () => {
    const achados = fatosSemLastro(
      'Ficamos na Rua Sete de Setembro, 250, Centro — Vitória/ES.',
      '[Endereço] Nosso escritório: Rua Sete de Setembro, nº 250, Centro, Vitória - ES.',
    );

    expect(achados).toEqual([]);
  });

  it('aceita diferença de escrita entre a fonte e a resposta', () => {
    // A IA reescreve com as próprias palavras; exigir o texto idêntico
    // barraria resposta certa o tempo todo.
    const achados = fatosSemLastro(
      'Estamos na Avenida Nossa Senhora dos Navegantes, 675.',
      'Endereço: Av. Nossa Senhora dos Navegantes, 675 - Enseada do Suá.',
    );

    expect(achados).toEqual([]);
  });
});

describe('outros dados concretos', () => {
  it.each([
    ['valor', 'A consulta custa R$ 350,00.'],
    ['telefone', 'Pode ligar no (27) 3333-4444.'],
    ['e-mail', 'Manda pra contato@escritorio.com.br.'],
    ['CNPJ', 'Nosso CNPJ é 12.345.678/0001-90.'],
    ['CEP', 'O CEP aqui é 29050-335.'],
  ])('barra %s sem lastro', (tipo, resposta) => {
    const achados = fatosSemLastro(resposta, 'Somos um escritório de advocacia.');

    expect(achados).toHaveLength(1);
    expect(achados[0].tipo).toBe(tipo);
  });

  it('deixa passar o valor que veio da base', () => {
    const achados = fatosSemLastro(
      'A primeira consulta é R$ 350,00.',
      '[Tabela] Consulta inicial: R$350,00. Acompanhamento: R$ 200,00.',
    );

    expect(achados).toEqual([]);
  });
});

describe('o que o cliente mesmo escreveu', () => {
  it('repetir o dado do cliente não é inventar', () => {
    // Confirmar de volta o que a pessoa acabou de informar é exatamente o
    // que se espera de um atendimento. O histórico entra nas fontes por
    // isso.
    const achados = fatosSemLastro(
      'Confirmando: seu e-mail é renan@exemplo.com, certo?',
      'Cliente: meu e-mail é renan@exemplo.com',
    );

    expect(achados).toEqual([]);
  });
});

describe('resposta que não afirma dado nenhum', () => {
  it.each([
    'Olá, Renan! Como posso te ajudar hoje?',
    'Claro, me conta um pouco mais sobre o seu caso.',
    'Nosso atendimento é de segunda a sexta, das 08h às 17h.',
    'Vou passar seu caso para o setor jurídico.',
  ])('passa sem alarme: %s', (resposta) => {
    expect(fatosSemLastro(resposta, NADA)).toEqual([]);
  });
});

describe('o mesmo dado repetido', () => {
  it('conta uma vez só — a nota do painel não precisa repetir', () => {
    const achados = fatosSemLastro(
      'Ligue para (27) 3333-4444. Se não atender, tente o (27) 3333-4444 mais tarde.',
      NADA,
    );

    expect(achados).toHaveLength(1);
  });
});

describe('poda: o certo continua indo, só o inventado sai', () => {
  /**
   * O relato que mudou esta trava: o cliente perguntou o horário de
   * atendimento — que ESTÁ cadastrado —, a IA respondeu o horário certo e
   * emendou um preço que ninguém cadastrou. Barrar a resposta inteira fez
   * a pessoa receber "vou confirmar com a equipe" para uma pergunta que o
   * sistema sabia responder. Barrar demais quebra o atendimento tão bem
   * quanto responder errado.
   */
  it('mantém a frase com lastro e derruba a inventada', () => {
    const { texto, removidos } = podarFatosSemLastro(
      'Atendemos de segunda a sexta, das 08h às 17h. A consulta inicial custa R$ 350,00.',
      '[Instruções] Horário de atendimento: segunda a sexta, das 08h às 17h.',
    );

    expect(removidos).toHaveLength(1);
    expect(texto).toContain('08h às 17h');
    expect(texto).not.toContain('350');
  });

  it('poda por parágrafo também — a IA escreve sem ponto final', () => {
    const { texto } = podarFatosSemLastro(
      'Claro, Renan! Nosso horário é das 08h às 17h\nO valor da consulta é R$ 500,00',
      'Horário: das 08h às 17h.',
    );

    expect(texto).toContain('08h às 17h');
    expect(texto).not.toContain('500');
  });

  it('devolve vazio quando não sobra resposta de verdade', () => {
    // "Claro!" sozinho não responde nada — melhor a frase de
    // encaminhamento falar por inteiro.
    const { texto, removidos } = podarFatosSemLastro(
      'Claro! Ficamos na Avenida Paulista, 1000.',
      'Somos um escritório.',
    );

    expect(removidos).toHaveLength(1);
    expect(texto).toBe('');
  });

  it('não mexe na resposta quando não há nada a podar', () => {
    const original = 'Nosso horário é de segunda a sexta, das 08h às 17h.';
    const { texto, removidos } = podarFatosSemLastro(original, 'das 08h às 17h');

    expect(removidos).toEqual([]);
    expect(texto).toBe(original);
  });
});
