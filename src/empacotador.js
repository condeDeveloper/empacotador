/**
 * O empacotador: junta tudo num arquivo só.
 *
 * O pacote tem três partes: um registro de módulos (cada um uma função), um
 * `__exigir` que executa sob demanda e guarda o resultado, e a chamada da
 * entrada. É o mesmo desenho de todo empacotador clássico, com trinta linhas
 * em vez de trinta mil.
 *
 * O `__cache` é gravado **antes** de o módulo rodar. Parece detalhe e não é:
 * é o que impede que uma dependência circular entre em recursão infinita.
 * O que ela devolve é um objeto ainda vazio — que é exatamente por que este
 * projeto recusa ciclos por padrão em vez de fingir que deu certo.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { acharCiclos, montarGrafo, ordenar } from './grafo.js';
import { transformar } from './transformacao.js';
import { identidade } from './resolucao.js';

/** O cabeçalho do pacote: o registro e o `exigir`. */
export const TEMPO_DE_EXECUCAO = `const __registro = Object.create(null);
const __cache = Object.create(null);

function __definir(modulo, nome, obter) {
  Object.defineProperty(modulo.exportacoes, nome, { get: obter, enumerable: true, configurable: true });
}

function __reexportar(modulo, origem) {
  for (const nome of Object.keys(origem)) {
    if (nome === 'padrao') continue;
    __definir(modulo, nome, () => origem[nome]);
  }
}

function __exigir(id) {
  const guardado = __cache[id];

  if (guardado !== undefined) return guardado.exportacoes;

  const modulo = { exportacoes: Object.create(null) };

  // Guardar antes de executar é o que impede recursão infinita num ciclo.
  __cache[id] = modulo;
  __registro[id](modulo, __exigir);

  return modulo.exportacoes;
}`;

/**
 * Monta o pacote.
 *
 * @param {string} entrada caminho do módulo de entrada
 * @param {{raiz?: string, permitirCiclo?: boolean, formato?: 'iife'|'nu'}} opcoes
 */
export async function empacotar(entrada, { raiz = process.cwd(), permitirCiclo = false, formato = 'iife' } = {}) {
  const absoluta = resolve(entrada);
  const grafo = await montarGrafo(absoluta, { raiz });
  const { ordem } = ordenar(grafo, { permitirCiclo });
  const ciclos = permitirCiclo ? acharCiclos(grafo) : [];

  const idDe = (caminho) => identidade(caminho, raiz);
  const pedacos = [];

  for (const caminho of ordem) {
    const modulo = grafo.modulos.get(caminho);
    const corpo = transformar(modulo.codigo, { dependencias: modulo.dependencias, idDe });

    pedacos.push(
      `__registro[${JSON.stringify(modulo.id)}] = (__modulo, __exigir) => {\n${recuar(corpo)}\n};`,
    );
  }

  const miolo = [TEMPO_DE_EXECUCAO, '', ...pedacos, '', `__exigir(${JSON.stringify(idDe(absoluta))});`].join('\n');

  const codigo =
    formato === 'nu' ? `${miolo}\n` : `// Gerado pelo empacotador.\n(() => {\n${recuar(miolo)}\n})();\n`;

  return {
    codigo,
    ordem: ordem.map(idDe),
    ciclos,
    modulos: grafo.modulos.size,
    bytes: Buffer.byteLength(codigo),
  };
}

/** Empacota e grava. */
export async function empacotarPara(entrada, saida, opcoes = {}) {
  const pacote = await empacotar(entrada, opcoes);

  await writeFile(saida, pacote.codigo, 'utf8');

  return { ...pacote, saida };
}

/** Recua um bloco inteiro em dois espaços, preservando linhas vazias. */
export function recuar(texto, espacos = 2) {
  const prefixo = ' '.repeat(espacos);

  return texto
    .split('\n')
    .map((linha) => (linha.trim() === '' ? linha : prefixo + linha))
    .join('\n');
}
