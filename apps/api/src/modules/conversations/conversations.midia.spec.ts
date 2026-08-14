import { mediaIdDe } from './conversations.service';

/**
 * O espelho do id de mídia.
 *
 * A coluna `mediaId` é o que o proxy de anexo consulta pra achar a
 * mensagem dona de um arquivo. Se ela ficar vazia numa gravação, o balão
 * aparece na conversa e o anexo simplesmente não abre — e o defeito só
 * aparece dias depois, quando alguém tenta ver a foto de novo.
 *
 * Por isso a extração é uma função só, testada aqui: os cinco caminhos que
 * gravam mensagem com mídia (anexo do painel, encaminhamento, webhook,
 * eco do celular e importação de histórico) passam todos por ela.
 */
describe('mediaIdDe', () => {
  it('tira o id do metadata de um anexo', () => {
    expect(
      mediaIdDe({ mediaId: 'meta-123', mimeType: 'image/png', size: 4096 }),
    ).toBe('meta-123');
  });

  it('mensagem de texto não tem mídia nenhuma', () => {
    expect(mediaIdDe(undefined)).toBeUndefined();
    expect(mediaIdDe(null)).toBeUndefined();
    expect(mediaIdDe({})).toBeUndefined();
  });

  it('metadata sem mídia (localização, contato) não vira id', () => {
    expect(mediaIdDe({ latitude: -20.3, longitude: -40.3 })).toBeUndefined();
    expect(mediaIdDe({ contacts: [{ name: 'Ana' }] })).toBeUndefined();
  });

  it('id vazio conta como ausente — string vazia não acha arquivo nenhum', () => {
    expect(mediaIdDe({ mediaId: '' })).toBeUndefined();
  });

  it('ignora valor que não é texto, em vez de gravar "[object Object]"', () => {
    expect(mediaIdDe({ mediaId: 12345 })).toBeUndefined();
    expect(mediaIdDe({ mediaId: { id: 'meta-123' } })).toBeUndefined();
    expect(mediaIdDe({ mediaId: null })).toBeUndefined();
  });

  it('não confunde lista com objeto de metadata', () => {
    expect(mediaIdDe([{ mediaId: 'meta-123' }])).toBeUndefined();
  });

  it('convive com a chave do bucket, que entra depois no mesmo metadata', () => {
    // O arquivamento acrescenta `storageKey` sem mexer no resto; o id tem
    // que continuar saindo igual.
    expect(
      mediaIdDe({
        mediaId: 'meta-123',
        mimeType: 'audio/ogg; codecs=opus',
        storageKey: 'tenant-a/2026/08/meta-123.ogg',
      }),
    ).toBe('meta-123');
  });
});
