import { STATUS_GROUPS, mediaKindFor } from './conversations.service';

/**
 * Regras que já quebraram uma vez e voltaram como reclamação de quem usa.
 * Cada bloco aqui é um defeito relatado, transformado em teste pra não
 * precisar ser relatado de novo.
 */
describe('grupos de status do Inbox', () => {
  it('Pendentes inclui conversa aguardando o cliente', () => {
    // O defeito: quem só olhava Pendentes perdia de vista um atendimento em
    // aberto porque a última fala tinha sido da empresa.
    expect(STATUS_GROUPS.PENDING).toContain('WAITING_CUSTOMER');
  });

  it('Pendentes é tudo que não foi encerrado', () => {
    const encerrados = STATUS_GROUPS.DONE as readonly string[];
    for (const status of STATUS_GROUPS.PENDING) {
      expect(encerrados).not.toContain(status);
    }
    expect(STATUS_GROUPS.PENDING).toEqual(
      expect.arrayContaining(['OPEN', 'WAITING_AGENT', 'WAITING_CUSTOMER']),
    );
  });

  it('Aguardando é um recorte de Pendentes, não um compartimento à parte', () => {
    const pendentes = STATUS_GROUPS.PENDING as readonly string[];
    for (const status of STATUS_GROUPS.WAITING) {
      expect(pendentes).toContain(status);
    }
  });

  it('resolvida e fechada ficam fora de Pendentes', () => {
    const pendentes = STATUS_GROUPS.PENDING as readonly string[];
    expect(pendentes).not.toContain('RESOLVED');
    expect(pendentes).not.toContain('CLOSED');
  });
});

describe('tipo de mídia enviada pro WhatsApp', () => {
  it('webp vira figurinha, não foto', () => {
    // Como imagem, a figurinha chega no aparelho como um quadrado branco.
    expect(mediaKindFor('image/webp')).toBe('sticker');
  });

  it('outras imagens continuam imagem', () => {
    expect(mediaKindFor('image/png')).toBe('image');
    expect(mediaKindFor('image/jpeg')).toBe('image');
  });

  it('áudio, vídeo e o resto caem no balde certo', () => {
    expect(mediaKindFor('audio/ogg')).toBe('audio');
    expect(mediaKindFor('video/mp4')).toBe('video');
    expect(mediaKindFor('application/pdf')).toBe('document');
    // Tipo desconhecido vai como documento, que aceita qualquer coisa.
    expect(mediaKindFor('application/octet-stream')).toBe('document');
  });
});
