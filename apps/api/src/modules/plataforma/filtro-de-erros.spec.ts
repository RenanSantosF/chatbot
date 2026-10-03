import { BadRequestException, HttpException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { emPortugues } from './filtro-de-erros';

describe('recusas do Nest, em português', () => {
  it('limite de tentativas', () => {
    const traduzida = emPortugues(new ThrottlerException(), 429);
    expect((traduzida as HttpException).message).toBe(
      'Muitas tentativas seguidas. Espere um minuto e tente de novo.',
    );
  });

  it('arquivo grande demais', () => {
    const traduzida = emPortugues(
      new HttpException('File too large', 413),
      413,
    );
    expect((traduzida as HttpException).getStatus()).toBe(413);
    expect((traduzida as HttpException).message).toContain('tamanho máximo');
  });

  it('o resto passa como veio', () => {
    const original = new BadRequestException('Telefone inválido.');
    expect(emPortugues(original, 400)).toBe(original);
  });
});
