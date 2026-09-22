/**
 * A resolução: de `'./util/soma.js'` para um caminho absoluto em disco.
 *
 * Parece a parte chata, e é a que mais causa bug de empacotador na vida real.
 * Dois módulos que resolvem para o **mesmo arquivo** por caminhos diferentes
 * viram dois módulos no pacote: o estado é duplicado, e um `Set` criado no
 * módulo passa a ter duas instâncias que não se enxergam.
 *
 * Por isso tudo aqui normaliza para um caminho absoluto e único, e é esse
 * caminho que serve de identidade do módulo no grafo.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Extensões tentadas quando o especificador não traz uma. */
export const EXTENSOES = ['.js', '.mjs', '.json'];

/** O módulo pedido não foi encontrado. */
export class ErroDeResolucao extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'ErroDeResolucao';
  }
}

/** Indica se o especificador aponta para um arquivo do projeto. */
export function ehRelativo(especificador) {
  return especificador.startsWith('./') || especificador.startsWith('../') || isAbsolute(especificador);
}

/** Tenta um caminho e suas variações com extensão e com índice. */
export function tentar(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;

  for (const extensao of EXTENSOES) {
    const comExtensao = base + extensao;

    if (existsSync(comExtensao) && statSync(comExtensao).isFile()) return comExtensao;
  }

  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const extensao of EXTENSOES) {
      const indice = join(base, `index${extensao}`);

      if (existsSync(indice)) return indice;
    }
  }

  return null;
}

/**
 * Resolve um especificador a partir de quem o importou.
 *
 * @param {string} especificador o texto dentro das aspas
 * @param {string} deQuem caminho absoluto do módulo que importou
 * @returns {string} caminho absoluto do módulo importado
 */
export function resolver(especificador, deQuem) {
  if (!ehRelativo(especificador)) {
    // Sem `node_modules`, e de propósito: resolver pacote instalado é um
    // algoritmo inteiro à parte, com `exports`, `imports` e condições.
    throw new ErroDeResolucao(
      `Só caminhos relativos: "${especificador}" (pedido por ${relative(process.cwd(), deQuem) || deQuem}).`,
    );
  }

  const base = isAbsolute(especificador) ? especificador : resolve(dirname(deQuem), especificador);
  const achado = tentar(base);

  if (achado === null) {
    throw new ErroDeResolucao(
      `Não achei "${especificador}" a partir de ${relative(process.cwd(), deQuem) || deQuem}.` +
        ` Tentei ${base} e as extensões ${EXTENSOES.join(', ')}.`,
    );
  }

  return resolve(achado);
}

/** Nome curto e estável do módulo, para aparecer no pacote e nos erros. */
export function identidade(caminho, raiz) {
  return relative(raiz, caminho).split(sep).join('/') || caminho;
}
