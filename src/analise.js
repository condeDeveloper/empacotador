/**
 * A análise: achar os `import` e os `export` de um módulo.
 *
 * Tudo aqui procura na **sombra** (ver `varredura.js`) e recorta do original.
 * A sombra tem o mesmo comprimento do código, então `match.index` vale para
 * os dois — e nenhum `import` dentro de comentário ou de texto entra na
 * conta.
 *
 * Isto não é um analisador sintático de JavaScript, e não precisa ser: um
 * empacotador só precisa acertar as bordas do módulo. O corpo passa inteiro,
 * intocado.
 */

import { sombra } from './varredura.js';

/** `import 'efeito.js'` — sem trazer nada. */
const SO_EFEITO = /(?<![.\w$])import\s+(['"])([^'"\n]*)\1\s*;?/g;

/** `import algo from 'x'` em todas as formas. */
const COM_CLAUSULA = /(?<![.\w$])import\s+([^;]*?)\s+from\s*(['"])([^'"\n]*)\2\s*;?/g;

/** `import('x')` — carregamento dinâmico. */
const DINAMICO = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]*)\1\s*\)/g;

/** `export * from 'x'` e `export * as ns from 'x'`. */
const REEXPORTA_TUDO = /(?<![.\w$])export\s+\*\s*(?:as\s+([\w$]+)\s*)?from\s*(['"])([^'"\n]*)\2\s*;?/g;

/** `export { a, b as c } from 'x'`. */
const REEXPORTA_ALGUNS = /(?<![.\w$])export\s*\{([^}]*)\}\s*from\s*(['"])([^'"\n]*)\2\s*;?/g;

/** `export { a, b as c }` do próprio módulo. */
const EXPORTA_LISTA = /(?<![.\w$])export\s*\{([^}]*)\}\s*;?/g;

/** `export default ...`. */
const EXPORTA_PADRAO = /(?<![.\w$])export\s+default\s/g;

/** `export const x`, `export function f`, `export class C`… */
const EXPORTA_DECLARACAO =
  /(?<![.\w$])export\s+(const|let|var|class|function\s*\*?|async\s+function\s*\*?)\s+([\w$]+)/g;

/** O módulo usa algo que este empacotador não faz. */
export class ErroDeAnalise extends Error {
  constructor(mensagem, posicao) {
    super(mensagem);
    this.name = 'ErroDeAnalise';
    this.posicao = posicao;
  }
}

/**
 * Quebra `a, b as c` em pares.
 *
 * Os campos se chamam `esquerda` e `direita` porque o `as` significa coisas
 * opostas nos dois lados: em `import { a as b }`, `a` é o nome lá fora; em
 * `export { a as b }`, `a` é o nome aqui dentro. Chamar um deles de "externo"
 * aqui só criaria confusão na hora de usar.
 */
export function lerEspecificadores(lista) {
  return lista
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const [esquerda, direita = esquerda] = parte.split(/\s+as\s+/).map((p) => p.trim());

      return { esquerda, direita };
    });
}

/**
 * Lê a cláusula de um import: o que vem entre `import` e `from`.
 *
 * Cobre `a`, `* as ns`, `{ x, y as z }` e as combinações com vírgula.
 */
export function lerClausula(clausula) {
  const resultado = { padrao: null, espacoDeNomes: null, nomes: [] };
  const texto = clausula.trim();

  // A vírgula que separa o padrão das chaves é a única no nível de fora.
  const chaves = texto.indexOf('{');
  const antes = chaves < 0 ? texto : texto.slice(0, chaves);
  const dentro = chaves < 0 ? '' : texto.slice(chaves + 1, texto.lastIndexOf('}'));

  for (const parte of antes.split(',').map((p) => p.trim()).filter(Boolean)) {
    const comoEspaco = /^\*\s*as\s+([\w$]+)$/.exec(parte);

    if (comoEspaco) resultado.espacoDeNomes = comoEspaco[1];
    else resultado.padrao = parte;
  }

  resultado.nomes = lerEspecificadores(dentro);

  return resultado;
}

/**
 * Analisa um módulo.
 *
 * Devolve as importações, as exportações e os trechos a substituir, cada um
 * com `inicio` e `fim` no código original.
 */
export function analisar(codigo, { caminho = '<memória>' } = {}) {
  const inerte = sombra(codigo);

  const importacoes = [];
  const exportacoes = [];
  const dinamicas = [];

  // ------------------------------------------------------------ importações

  for (const achado of inerte.matchAll(COM_CLAUSULA)) {
    // A cláusula só tem identificadores e chaves, então a sombra é igual ao
    // original ali — dá para usá-la direto.
    const clausula = lerClausula(achado[1]);
    const especificador = lerEspecificador(codigo, achado);

    importacoes.push({ especificador, ...clausula, inicio: achado.index, fim: achado.index + achado[0].length });
  }

  for (const achado of inerte.matchAll(SO_EFEITO)) {
    // O `import 'x'` puro não tem `from`, então não colide com o anterior.
    importacoes.push({
      especificador: lerEspecificador(codigo, achado, 2),
      padrao: null,
      espacoDeNomes: null,
      nomes: [],
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  for (const achado of inerte.matchAll(DINAMICO)) {
    dinamicas.push({
      especificador: lerEspecificador(codigo, achado, 2),
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  // ------------------------------------------------------------ exportações

  for (const achado of inerte.matchAll(REEXPORTA_TUDO)) {
    exportacoes.push({
      tipo: achado[1] ? 'espacoDeNomes' : 'tudo',
      nomeExterno: achado[1] ?? null,
      especificador: lerEspecificador(codigo, achado, 3),
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  for (const achado of inerte.matchAll(REEXPORTA_ALGUNS)) {
    exportacoes.push({
      tipo: 'reexporta',
      nomes: lerEspecificadores(achado[1]),
      especificador: lerEspecificador(codigo, achado, 3),
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  const jaCobertos = exportacoes.map((e) => [e.inicio, e.fim]);
  const dentroDeOutro = (inicio) => jaCobertos.some(([a, b]) => inicio >= a && inicio < b);

  for (const achado of inerte.matchAll(EXPORTA_LISTA)) {
    // `export { a } from 'x'` já foi pego acima; sem isto ele contaria duas vezes.
    if (dentroDeOutro(achado.index)) continue;

    exportacoes.push({
      tipo: 'lista',
      nomes: lerEspecificadores(achado[1]),
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  for (const achado of inerte.matchAll(EXPORTA_DECLARACAO)) {
    exportacoes.push({
      tipo: 'declaracao',
      nome: achado[2],
      inicio: achado.index,
      fim: achado.index + achado[0].length,
      // Só a palavra `export` sai; a declaração continua onde estava.
      recorte: [achado.index, achado.index + achado[0].indexOf(achado[1])],
    });
  }

  for (const achado of inerte.matchAll(EXPORTA_PADRAO)) {
    exportacoes.push({
      tipo: 'padrao',
      inicio: achado.index,
      fim: achado.index + achado[0].length,
    });
  }

  return { caminho, importacoes, exportacoes, dinamicas };
}

/**
 * Recorta o especificador do código original, nas aspas que a sombra achou.
 *
 * Na sombra o caminho virou espaço em branco, mas as aspas continuam onde
 * estavam — e o comprimento é o mesmo. Achar a aspa de fechamento e voltar o
 * tamanho do especificador dá a posição exata no original.
 */
function lerEspecificador(codigo, achado, grupo = 3) {
  const aspas = achado[grupo - 1];
  const fecha = achado[0].lastIndexOf(aspas);
  const inicio = achado.index + fecha - achado[grupo].length;

  return codigo.slice(inicio, inicio + achado[grupo].length);
}
