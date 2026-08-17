import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

/**
 * A aplicação inteira monta?
 *
 * Este teste existe por uma quebra em produção que os outros 679 não
 * pegaram, e não pegariam nunca: um controlador ganhou uma dependência
 * nova e o módulo dele não importava quem a fornece. Nada disso é erro de
 * tipo — o TypeScript compila feliz, os testes de unidade injetam os
 * dublês na mão, e o `nest build` passa. O Nest só descobre na
 * inicialização, quando resolve o grafo de dependências de verdade.
 *
 * O resultado é a pior categoria de defeito que existe aqui: o processo
 * não sobe. Não é uma tela quebrada nem uma mensagem que não sai — é o
 * produto inteiro fora do ar, e só se descobre olhando o log do deploy.
 *
 * `compile()` faz exatamente a parte que interessa: instancia todo mundo e
 * resolve as dependências. Não chama `init()`, então nenhum
 * `onModuleInit` roda — o Prisma não tenta conectar, o Socket.io não abre
 * porta, e o teste funciona numa máquina sem banco, que é o caso da
 * verificação automática.
 */
describe('o grafo de dependências da aplicação', () => {
  /*
   * Os segredos que alguns serviços exigem no construtor.
   *
   * Valores de mentira de propósito: nada aqui chega a ser usado, porque
   * `compile()` não liga ciclo de vida nenhum. O que se testa é a
   * MONTAGEM, e ela precisa que o construtor não recuse a subir — o
   * EncryptionService, por exemplo, se recusa a existir sem chave, que é
   * o comportamento certo dele.
   */
  const antes = { ...process.env };

  beforeAll(() => {
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64);
    process.env.JWT_SECRET ??= 'segredo-de-teste';
    process.env.DATABASE_URL ??=
      'postgresql://ninguem@localhost:5432/nao-conecta';
  });

  afterAll(() => {
    process.env = antes;
  });

  it('monta inteiro, com todos os módulos de verdade', async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Chegar aqui já é o teste: `compile()` estoura quando algum provider
    // não é encontrado. O `expect` existe pra a intenção ficar escrita.
    expect(modulo).toBeDefined();

    // Fecha sem `init()`, então nada de ciclo de vida foi ligado — mas o
    // fechamento explícito evita que o Jest fique com o processo preso.
    await modulo.close();
  }, 30_000);
});
