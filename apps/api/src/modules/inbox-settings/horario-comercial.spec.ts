import {
  EXPEDIENTE_PADRAO,
  agoraNaEmpresa,
  dentroDoExpediente,
  descreverSemana,
  escreverExpediente,
  lerExpediente,
  minutosAteFechar,
  proximaAbertura,
} from './horario-comercial';

/**
 * O relógio da empresa.
 *
 * Todos os instantes daqui são escritos em UTC ("Z") e conferidos no fuso de
 * São Paulo, que é UTC-3. É de propósito: o servidor roda em UTC e a empresa
 * vive três horas atrás, então qualquer conta feita com o relógio do
 * servidor erra — e erra exatamente perto da meia-noite, onde o dia da
 * semana também muda.
 */
const SP = 'America/Sao_Paulo';

// Sexta-feira, 14 de agosto de 2026.
const sexta = (hhmm: string) => new Date(`2026-08-14T${hhmm}:00Z`);

describe('que horas são pra empresa', () => {
  it('desconta o fuso, e com ele o dia da semana', () => {
    // 01:00 UTD de sexta ainda é quinta-feira, 22:00, em São Paulo. É este
    // caso que faz um expediente "de segunda a sexta" atender no sábado de
    // madrugada se a conta for feita em UTC.
    expect(agoraNaEmpresa(SP, sexta('01:00'))).toEqual({
      dia: 4, // quinta
      minutos: 22 * 60,
    });
  });

  it('meia-noite é zero, não vinte e quatro', () => {
    expect(agoraNaEmpresa(SP, sexta('03:00')).minutos).toBe(0);
  });
});

describe('está aberto?', () => {
  it('sim, no meio do expediente', () => {
    // 13:00 UTC = 10:00 em SP, sexta.
    expect(dentroDoExpediente(EXPEDIENTE_PADRAO, SP, sexta('13:00'))).toBe(true);
  });

  it('não, no horário de almoço', () => {
    // 15:30 UTC = 12:30 em SP.
    expect(dentroDoExpediente(EXPEDIENTE_PADRAO, SP, sexta('15:30'))).toBe(
      false,
    );
  });

  it('não, depois de fechar', () => {
    // 22:00 UTC = 19:00 em SP.
    expect(dentroDoExpediente(EXPEDIENTE_PADRAO, SP, sexta('22:00'))).toBe(
      false,
    );
  });

  it('não, no fim de semana', () => {
    // Sábado, 14:00 UTC = 11:00 em SP: horário comercial num dia sem
    // expediente.
    const sabado = new Date('2026-08-15T14:00:00Z');
    expect(dentroDoExpediente(EXPEDIENTE_PADRAO, SP, sabado)).toBe(false);
  });

  it('o minuto de fechar já é fora', () => {
    // 21:00 UTC = 18:00 em SP, o fim da faixa. Quem escreve às 18:00 em
    // ponto escreveu depois do expediente, não dentro dele.
    expect(dentroDoExpediente(EXPEDIENTE_PADRAO, SP, sexta('21:00'))).toBe(
      false,
    );
  });

  it('sem expediente configurado, atende sempre', () => {
    // Não é "fechado pra sempre": é o comportamento de quem nunca abriu a
    // tela, que precisa ser o mesmo de antes do recurso existir.
    const domingoDeMadrugada = new Date('2026-08-16T06:00:00Z');
    expect(dentroDoExpediente({}, SP, domingoDeMadrugada)).toBe(true);
  });
});

describe('quando a equipe volta', () => {
  it('no almoço, volta hoje mesmo', () => {
    expect(proximaAbertura(EXPEDIENTE_PADRAO, SP, sexta('15:30'))).toBe(
      'hoje às 13:00',
    );
  });

  it('sexta à noite, volta na segunda — não no sábado', () => {
    // O erro que esta linha impede: dizer "amanhã às 8h" pra quem escreve
    // na sexta à noite de uma empresa que não abre no fim de semana.
    expect(proximaAbertura(EXPEDIENTE_PADRAO, SP, sexta('22:00'))).toBe(
      'segunda-feira às 08:00',
    );
  });

  it('antes de abrir, é hoje', () => {
    // 10:00 UTC = 07:00 em SP.
    expect(proximaAbertura(EXPEDIENTE_PADRAO, SP, sexta('10:00'))).toBe(
      'hoje às 08:00',
    );
  });

  it('domingo, a próxima é amanhã', () => {
    const domingo = new Date('2026-08-16T18:00:00Z');
    expect(proximaAbertura(EXPEDIENTE_PADRAO, SP, domingo)).toBe(
      'amanhã às 08:00',
    );
  });

  it('empresa que só abre um dia acha a semana que vem', () => {
    const sóQuarta = { 3: [{ inicio: 9 * 60, fim: 17 * 60 }] };
    expect(proximaAbertura(sóQuarta, SP, sexta('13:00'))).toBe(
      'quarta-feira às 09:00',
    );
  });

  it('sem expediente, não há próxima abertura a anunciar', () => {
    expect(proximaAbertura({}, SP, sexta('13:00'))).toBeNull();
  });
});

describe('quanto falta pra fechar', () => {
  it('conta até o fim da faixa em que estamos', () => {
    // 13:00 UTC = 10:00 em SP; a faixa da manhã fecha às 12:00.
    expect(minutosAteFechar(EXPEDIENTE_PADRAO, SP, sexta('13:00'))).toBe(120);
  });

  it('fechado não tem contagem', () => {
    expect(minutosAteFechar(EXPEDIENTE_PADRAO, SP, sexta('22:00'))).toBeNull();
  });
});

describe('lendo o que veio do banco', () => {
  it('aceita o formato normal', () => {
    expect(lerExpediente({ '1': [['08:00', '18:00']] })).toEqual({
      1: [{ inicio: 480, fim: 1080 }],
    });
  });

  it('descarta faixa invertida, hora impossível e lixo', () => {
    // A coluna é Json: o que chega aqui não tem garantia nenhuma, e uma
    // faixa ruim não pode derrubar a resposta ao cliente.
    const sujo = {
      '1': [
        ['18:00', '08:00'], // invertida
        ['25:00', '26:00'], // hora que não existe
        ['08:00', '08:00'], // duração zero
        'nada disso',
        ['09:00', '17:00'], // esta vale
      ],
      '9': [['08:00', '18:00']], // dia que não existe
      lixo: 'texto',
    };

    expect(lerExpediente(sujo)).toEqual({ 1: [{ inicio: 540, fim: 1020 }] });
  });

  it('ordena as faixas do dia', () => {
    const foraDeOrdem = {
      '2': [
        ['13:00', '18:00'],
        ['08:00', '12:00'],
      ],
    };
    expect(lerExpediente(foraDeOrdem)[2][0].inicio).toBe(480);
  });

  it('nulo e formato errado viram expediente vazio', () => {
    expect(lerExpediente(null)).toEqual({});
    expect(lerExpediente([['08:00', '18:00']])).toEqual({});
    expect(lerExpediente('segunda a sexta')).toEqual({});
  });

  it('ida e volta não perde nada', () => {
    const original = { '1': [['08:00', '12:00'] as [string, string]] };
    expect(escreverExpediente(lerExpediente(original))).toEqual(original);
  });
});

describe('o expediente em palavras', () => {
  it('junta as faixas do dia numa linha só', () => {
    expect(descreverSemana(EXPEDIENTE_PADRAO)[0]).toBe(
      'segunda-feira: 08:00 às 12:00 e 13:00 às 18:00',
    );
  });

  it('só lista os dias que têm atendimento', () => {
    expect(descreverSemana(EXPEDIENTE_PADRAO)).toHaveLength(5);
  });
});
