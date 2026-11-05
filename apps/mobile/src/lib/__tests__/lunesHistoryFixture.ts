/**
 * Respostas REAIS do indexador SubQuery da Lunes (https://lunes-squid.lunes.io), gravadas em
 * 2026-11-04 com as consultas de `lib/lunesHistory.ts` (via `fetch` em Node, fora do app).
 * Conta pública consultada: 5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU (prefixo 42; 136 envios
 * e 13 recebimentos indexados na data). Só os 4 mais recentes de cada lado foram pedidos (`first: 4`).
 * Nada aqui foi editado à mão além de cortar o `stacktrace` do erro.
 */

/** Conta consultada (prefixo 42, como o indexador guarda) e a mesma conta no prefixo 57 da Lunes. */
export const ACCOUNT_42 = '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU';

/** `AccountTransfers` para ACCOUNT_42, first: 4. `timestamp`/`date` dos transfers vêm sempre null neste indexador. */
export const ACCOUNT_TRANSFERS = {
  data: {
    sent: {
      nodes: [
        { id: '13301965-11', fromId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', toId: '5FdBnjdv1REge2AetPxPsDseaTUY5NtqkLFtmxsNnYeczkTP', amount: '3320', blockNumber: '13301965', eventIndex: 11 },
        { id: '13301965-4', fromId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', toId: '5FdBnjdv1REge2AetPxPsDseaTUY5NtqkLFtmxsNnYeczkTP', amount: '6160', blockNumber: '13301965', eventIndex: 4 },
        { id: '13301965-7', fromId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', toId: '5DT3Z6eNweUw73ihbiRPrm55ckzK9Y79yuHjFQ3XCrL9hbTn', amount: '500', blockNumber: '13301965', eventIndex: 7 },
        { id: '13240750-3', fromId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', toId: '5HFeBxLsGH6cFZAEQjTdvyRKfW53EVuZZA5m92Jo1bRh8XfG', amount: '1320', blockNumber: '13240750', eventIndex: 3 },
      ],
      totalCount: 136,
    },
    received: {
      nodes: [
        { id: '9850483-2', fromId: '5EZFwuMfbRkXb5sW1GMo3zUmTWQXB9tgtYbrvnu4twQz8y1B', toId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', amount: '500', blockNumber: '9850483', eventIndex: 2 },
        { id: '9048626-2', fromId: '5DFeJ3WLzpQ1SVesnAhsbYbg6m5bSruoLN9ENSxQogjXXskc', toId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', amount: '490000000000', blockNumber: '9048626', eventIndex: 2 },
        { id: '9048614-2', fromId: '5CNUWeLmycyEoGmsMZdbgbTq5tmFkfDQKTaj2jV9zcaSyFds', toId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', amount: '1000069000000', blockNumber: '9048614', eventIndex: 2 },
        { id: '8987968-20', fromId: '5Dd1fuPqGMejZ4KsjVKb79waJmLGbsyK85pttnJV6S1fKN1f', toId: '5F4vNdAQrabivM3cq5kAfpthhEyxtcfkq7YXT57ExWUGQ9SU', amount: '4999999999', blockNumber: '8987968', eventIndex: 20 },
      ],
      totalCount: 13,
    },
  },
};

/** `BlockTimes` para os blocos acima (o indexador devolve em outra ordem; `timestamp` em ms, texto). */
export const BLOCK_TIMES = {
  data: {
    blocks: {
      nodes: [
        { id: '13240750', number: '13240750', timestamp: '1793462562000' },
        { id: '13301965', number: '13301965', timestamp: '1793830332000' },
        { id: '8987968', number: '8987968', timestamp: '1767893730000' },
        { id: '9048614', number: '9048614', timestamp: '1768257624001' },
        { id: '9048626', number: '9048626', timestamp: '1768257696000' },
        { id: '9850483', number: '9850483', timestamp: '1773089238000' },
      ],
    },
  },
};

/** Conta sem nenhuma movimentação indexada (Alice de desenvolvimento, prefixo 57). */
export const EMPTY_TRANSFERS = { data: { sent: { nodes: [], totalCount: 0 }, received: { nodes: [], totalCount: 0 } } };

/** HTTP 400 com `errors` quando a consulta não valida (campo inexistente). */
export const GRAPHQL_ERROR = {
  status: 400,
  body: { errors: [{ message: 'Cannot query field "nope" on type "Transfer".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] },
};
