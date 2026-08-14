import { motivoDaMeta } from './meta-erro';

/**
 * Cada caso aqui é uma forma de erro que a Meta já devolveu em produção. O
 * que se protege não é a função em si: é a garantia de que nenhuma resposta
 * dela derruba a requisição com erro de parse, porque quando isso acontece
 * o atendente recebe "erro interno" no lugar do motivo de verdade.
 */
describe('motivoDaMeta', () => {
  it('prefere a mensagem escrita para humanos', () => {
    const body = JSON.stringify({
      error: {
        message: '(#131053) Media upload error',
        error_user_msg: 'O formato do áudio não é aceito.',
      },
    });

    expect(motivoDaMeta(body, 400)).toBe('O formato do áudio não é aceito.');
  });

  it('cai na mensagem técnica quando não há versão para humanos', () => {
    const body = JSON.stringify({
      error: { message: 'Invalid OAuth access token' },
    });

    expect(motivoDaMeta(body, 401)).toBe('Invalid OAuth access token');
  });

  it('não quebra com HTML — é o que o proxy da Meta devolve quando ela cai', () => {
    const body = '<html><head><title>502 Bad Gateway</title></head></html>';

    expect(motivoDaMeta(body, 502)).toBe('erro HTTP 502');
  });

  it('não quebra com corpo vazio', () => {
    expect(motivoDaMeta('', 500)).toBe('erro HTTP 500');
  });

  it('usa o código HTTP quando o JSON é válido mas não tem erro dentro', () => {
    expect(motivoDaMeta(JSON.stringify({ data: [] }), 400)).toBe(
      'erro HTTP 400',
    );
  });
});
