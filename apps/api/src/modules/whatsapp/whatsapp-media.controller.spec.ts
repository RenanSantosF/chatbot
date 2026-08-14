import { WhatsappMediaController } from './whatsapp-media.controller';

/**
 * Resposta parcial (cabeçalho `Range`) no proxy de mídia.
 *
 * Sem isto, áudio e vídeo viram um bloco que só toca do começo ao fim: a
 * barra fica travada e a duração aparece inventada — "5:04" pra sete
 * segundos de áudio. O motivo é concreto: a duração de um Ogg mora na
 * ÚLTIMA página do arquivo, e o navegador a lê pedindo os últimos bytes.
 * Se o servidor ignora o Range e devolve tudo do começo, ele nunca alcança
 * o fim e chuta.
 */
const controller = new WhatsappMediaController({} as never);
const faixa = (header: string | undefined, tamanho: number) =>
  (
    controller as unknown as {
      faixaPedida: (
        h: string | undefined,
        t: number,
      ) => { inicio: number; fim: number } | null;
    }
  ).faixaPedida(header, tamanho);

describe('sem pedido de faixa', () => {
  it('sem cabeçalho, serve o arquivo inteiro', () => {
    expect(faixa(undefined, 1000)).toBeNull();
  });

  it('cabeçalho em formato que ninguém manda também serve inteiro', () => {
    // Faixas múltiplas exigiriam resposta multipart, que nenhum player pede.
    expect(faixa('bytes=0-99,200-299', 1000)).toBeNull();
    expect(faixa('items=0-99', 1000)).toBeNull();
    expect(faixa('lixo', 1000)).toBeNull();
  });
});

describe('faixa comum', () => {
  it('início e fim explícitos', () => {
    expect(faixa('bytes=0-499', 1000)).toEqual({ inicio: 0, fim: 499 });
  });

  it('início sem fim vai até o último byte', () => {
    expect(faixa('bytes=500-', 1000)).toEqual({ inicio: 500, fim: 999 });
  });

  it('fim além do arquivo é aparado, não recusado', () => {
    // Player pedindo mais do que existe é rotina; recusar aqui trava a
    // reprodução por um pedido que a norma manda atender.
    expect(faixa('bytes=900-99999', 1000)).toEqual({ inicio: 900, fim: 999 });
  });

  it('arquivo inteiro pedido explicitamente', () => {
    expect(faixa('bytes=0-', 1000)).toEqual({ inicio: 0, fim: 999 });
  });

  it('ignora espaço em volta, que aparece em cabeçalho de verdade', () => {
    expect(faixa('  bytes=0-99  ', 1000)).toEqual({ inicio: 0, fim: 99 });
  });
});

describe('sufixo — os últimos N bytes', () => {
  it('é assim que o navegador lê a duração de um Ogg', () => {
    expect(faixa('bytes=-500', 1000)).toEqual({ inicio: 500, fim: 999 });
  });

  it('pedir mais do que o arquivo tem devolve o arquivo todo', () => {
    expect(faixa('bytes=-5000', 1000)).toEqual({ inicio: 0, fim: 999 });
  });

  it('pedir zero byte do fim não é uma faixa', () => {
    expect(faixa('bytes=-0', 1000)).toBeNull();
  });
});

describe('faixa que não faz sentido', () => {
  it('começo depois do fim', () => {
    expect(faixa('bytes=500-100', 1000)).toBeNull();
  });

  it('começo além do arquivo', () => {
    expect(faixa('bytes=2000-', 1000)).toBeNull();
  });

  it('sem número nenhum', () => {
    expect(faixa('bytes=-', 1000)).toBeNull();
  });

  it('último byte exato ainda é válido', () => {
    expect(faixa('bytes=999-999', 1000)).toEqual({ inicio: 999, fim: 999 });
  });
});
