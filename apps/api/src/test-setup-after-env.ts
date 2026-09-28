import { limparTodosOsCaches } from './common/cache/cache-curto';

/**
 * Cada teste começa com os caches em memória vazios.
 *
 * Eles são do processo (ver CacheCurto), e os testes reusam a mesma
 * empresa e o mesmo usuário de mentira: sem isto, o valor lembrado num
 * teste respondia pelo banco falso do seguinte.
 */
beforeEach(() => limparTodosOsCaches());
