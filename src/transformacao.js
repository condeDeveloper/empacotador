/**
 * A transformação: de módulo ES para uma função.
 *
 * Um pacote é um arquivo só, e um arquivo não pode ter `import` no meio. Cada
 * módulo vira então uma função que recebe um objeto de exportações e um
 * `exigir`, e o corpo continua **exatamente o mesmo** — só as bordas mudam.
 *
 * As exportações viram getters, não cópias. Assim, quando um módulo reatribui
 * um `let` que exporta, quem lê pelo espaço de nomes enxerga o novo valor.
 * Já `import { a }` copia o valor na entrada, porque `const a` não pode ser
 * um getter — é o limite que o README declara e que um teste documenta.
 */

import { analisar } from './analise.js';

/** Nome interno do `export default`, que não é um identificador válido. */
export const PADRAO = 'padrao';

/** Aplica as substituições de trás para a frente, para os índices não andarem. */
export function substituir(codigo, trocas) {
  const ordenadas = [...trocas].sort((a, b) => b.inicio - a.inicio);

  let saida = codigo;

  for (const { inicio, fim, texto } of ordenadas) {
    saida = saida.slice(0, inicio) + texto + saida.slice(fim);
  }

  return saida;
}

/**
 * Reescreve um módulo.
 *
 * @param {string} codigo
 * @param {{dependencias: Map<string,string>, idDe: (caminho: string) => string}} contexto
 * @returns {string} o corpo da função do módulo
 */
export function transformar(codigo, { dependencias, idDe }) {
  const { importacoes, exportacoes } = analisar(codigo);
  const trocas = [];
  const depois = [];

  /** O `__exigir('...')` correspondente a um especificador. */
  const exigir = (especificador) => `__exigir(${JSON.stringify(idDe(dependencias.get(especificador)))})`;

  // ------------------------------------------------------------ importações

  let contador = 0;

  for (const importacao of importacoes) {
    const apelido = `__m${contador++}`;
    const partes = [`const ${apelido} = ${exigir(importacao.especificador)};`];

    if (importacao.espacoDeNomes) partes.push(`const ${importacao.espacoDeNomes} = ${apelido};`);

    if (importacao.padrao) partes.push(`const ${importacao.padrao} = ${apelido}.${PADRAO};`);

    for (const { esquerda, direita } of importacao.nomes) {
      partes.push(`const ${direita} = ${apelido}.${esquerda};`);
    }

    trocas.push({ inicio: importacao.inicio, fim: importacao.fim, texto: partes.join(' ') });
  }

  // ------------------------------------------------------------ exportações

  for (const exportacao of exportacoes) {
    if (exportacao.tipo === 'declaracao') {
      // Só a palavra `export` sai; `const x = 1` fica onde estava.
      trocas.push({ inicio: exportacao.recorte[0], fim: exportacao.recorte[1], texto: '' });
      depois.push(definir(exportacao.nome, exportacao.nome));
      continue;
    }

    if (exportacao.tipo === 'padrao') {
      trocas.push({ inicio: exportacao.inicio, fim: exportacao.fim, texto: `const __${PADRAO} = ` });
      depois.push(definir(PADRAO, `__${PADRAO}`));
      continue;
    }

    if (exportacao.tipo === 'lista') {
      trocas.push({ inicio: exportacao.inicio, fim: exportacao.fim, texto: '' });

      for (const { esquerda, direita } of exportacao.nomes) depois.push(definir(direita, esquerda));

      continue;
    }

    if (exportacao.tipo === 'reexporta') {
      const apelido = `__r${contador++}`;

      trocas.push({
        inicio: exportacao.inicio,
        fim: exportacao.fim,
        texto: `const ${apelido} = ${exigir(exportacao.especificador)};`,
      });

      for (const { esquerda, direita } of exportacao.nomes) {
        depois.push(definir(direita, `${apelido}.${esquerda}`));
      }

      continue;
    }

    if (exportacao.tipo === 'espacoDeNomes') {
      const apelido = `__r${contador++}`;

      trocas.push({
        inicio: exportacao.inicio,
        fim: exportacao.fim,
        texto: `const ${apelido} = ${exigir(exportacao.especificador)};`,
      });

      depois.push(definir(exportacao.nomeExterno, apelido));
      continue;
    }

    // `export * from 'x'`: copia tudo, menos o padrão — que pela
    // especificação **não** é reexportado pelo asterisco.
    const apelido = `__r${contador++}`;

    trocas.push({
      inicio: exportacao.inicio,
      fim: exportacao.fim,
      texto: `const ${apelido} = ${exigir(exportacao.especificador)};`,
    });

    depois.push(`__reexportar(__modulo, ${apelido});`);
  }

  const corpo = substituir(codigo, trocas);

  const enxuto = corpo.replace(/\s*$/, '');

  return depois.length === 0 ? enxuto : `${enxuto}\n\n${depois.join('\n')}`;
}

/** Instala uma exportação como getter, para a ligação continuar viva. */
function definir(nome, expressao) {
  return `__definir(__modulo, ${JSON.stringify(nome)}, () => ${expressao});`;
}
