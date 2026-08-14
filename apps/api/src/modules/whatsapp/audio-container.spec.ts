import { isAcceptedAudio, jaEhOggOpus } from './audio-container';

/**
 * A distinção entre "a Meta aceita no upload" e "a Meta reproduz na
 * mensagem" é a causa raiz de um defeito que custou dias: um áudio gravado
 * no navegador subia sem erro e o envio era recusado depois, deixando o
 * atendente com um balão vermelho sem explicação.
 *
 * Estes testes fixam a diferença. Se alguém trocar `jaEhOggOpus` por
 * `isAcceptedAudio` no caminho de conversão achando que dá no mesmo, o
 * defeito volta — e é este arquivo que avisa.
 */
describe('formatos de áudio', () => {
  describe('isAcceptedAudio (o que passa no upload)', () => {
    it.each([
      'audio/aac',
      'audio/amr',
      'audio/mp4',
      'audio/mpeg',
      'audio/ogg',
      'audio/ogg;codecs=opus',
    ])('aceita %s', (tipo) => {
      expect(isAcceptedAudio(tipo)).toBe(true);
    });

    it('recusa webm, que é justamente o que o Chrome grava', () => {
      expect(isAcceptedAudio('audio/webm;codecs=opus')).toBe(false);
    });
  });

  describe('jaEhOggOpus (o que dispensa conversão)', () => {
    it('só o ogg dispensa', () => {
      expect(jaEhOggOpus('audio/ogg')).toBe(true);
      expect(jaEhOggOpus('audio/ogg;codecs=opus')).toBe(true);
    });

    it('mp4 precisa converter mesmo sendo aceito no upload', () => {
      // Este é o caso do defeito: aceito na porta, recusado na entrega.
      expect(isAcceptedAudio('audio/mp4')).toBe(true);
      expect(jaEhOggOpus('audio/mp4')).toBe(false);
    });

    it('ignora caixa alta e espaço, que aparecem em Content-Type de verdade', () => {
      expect(jaEhOggOpus('AUDIO/OGG ; codecs=opus')).toBe(true);
    });
  });
});
