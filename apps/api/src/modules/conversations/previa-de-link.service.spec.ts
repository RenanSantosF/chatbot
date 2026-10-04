import { enderecoInterno, lerPrevia } from './previa-de-link.service';

describe('prévia de link', () => {
  it('lê título, descrição e imagem do Open Graph', () => {
    const html = `<html><head>
      <title>Título da aba</title>
      <meta property="og:title" content="Promoção de Outubro &amp; mais">
      <meta content="Até 50% em toda a loja" property="og:description" />
      <meta property='og:image' content='/img/capa.jpg'>
      <meta property="og:site_name" content="Loja Sol">
    </head></html>`;

    expect(lerPrevia(html, 'https://loja.com.br/promo')).toEqual({
      titulo: 'Promoção de Outubro & mais',
      descricao: 'Até 50% em toda a loja',
      imagem: 'https://loja.com.br/img/capa.jpg',
      site: 'Loja Sol',
    });
  });

  it('sem Open Graph, usa o <title> e o domínio', () => {
    const previa = lerPrevia(
      '<title>Bem-vindo</title><meta name="description" content="Oi">',
      'https://www.exemplo.com/',
    );
    expect(previa).toMatchObject({
      titulo: 'Bem-vindo',
      descricao: 'Oi',
      site: 'exemplo.com',
    });
  });

  it('imagem http vira https (o painel bloquearia conteúdo misto)', () => {
    const previa = lerPrevia(
      '<meta property="og:title" content="X"><meta property="og:image" content="http://cdn.x.com/a.png">',
      'https://x.com',
    );
    expect(previa.imagem).toBe('https://cdn.x.com/a.png');
  });
});

/**
 * Qualquer pessoa no WhatsApp escolhe o link que a API vai abrir. Sem esta
 * trava, um link pra rede interna faria a API ler o que não devia.
 */
describe('endereços que a prévia não abre', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.20.1.1',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('%s é interno', (ip) => {
    expect(enderecoInterno(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5'])(
    '%s é público',
    (ip) => {
      expect(enderecoInterno(ip)).toBe(false);
    },
  );
});
