/**
 * O grafo de dependências e a ordem de execução.
 *
 * Um pacote é um arquivo só, e um arquivo executa de cima para baixo. Então o
 * empacotador precisa decidir **em que ordem** os módulos entram — e essa
 * ordem é a topológica: quem é importado vem antes de quem importa.
 *
 * O caso interessante é o ciclo. `a.js` importa `b.js`, que importa `a.js` de
 * volta: não existe ordem que satisfaça os dois. Módulos ES lidam com isso
 * com ligações vivas; um pacote simples como este não tem como. O que dá para
 * fazer — e é o que este arquivo faz — é **detectar** o ciclo e dizer exatamente
 * qual é o caminho dele, em vez de emitir um pacote que quebra em tempo de
 * execução com `undefined is not a function`.
 */

import { readFile } from 'node:fs/promises';

import { analisar } from './analise.js';
import { identidade, resolver } from './resolucao.js';

/** O grafo não pôde ser montado. */
export class ErroDeGrafo extends Error {
  constructor(mensagem, ciclo = null) {
    super(mensagem);
    this.name = 'ErroDeGrafo';
    this.ciclo = ciclo;
  }
}

/**
 * Percorre o projeto a partir da entrada e monta o grafo.
 *
 * @param {string} entrada caminho absoluto do módulo de entrada
 * @param {{raiz?: string, ler?: (caminho: string) => Promise<string>}} opcoes
 */
export async function montarGrafo(entrada, { raiz = process.cwd(), ler = (c) => readFile(c, 'utf8') } = {}) {
  /** @type {Map<string, {caminho: string, id: string, codigo: string, analise: object, dependencias: Map<string,string>}>} */
  const modulos = new Map();

  const visitar = async (caminho) => {
    // Já visitado: é o que faz um módulo importado por cinco outros entrar
    // uma vez só no pacote.
    if (modulos.has(caminho)) return;

    const codigo = await ler(caminho);
    const analise = analisar(codigo, { caminho });
    const dependencias = new Map();

    modulos.set(caminho, { caminho, id: identidade(caminho, raiz), codigo, analise, dependencias });

    const especificadores = [
      ...analise.importacoes.map((i) => i.especificador),
      ...analise.exportacoes.filter((e) => e.especificador).map((e) => e.especificador),
    ];

    for (const especificador of especificadores) {
      if (dependencias.has(especificador)) continue;

      const alvo = resolver(especificador, caminho);

      dependencias.set(especificador, alvo);

      await visitar(alvo);
    }
  };

  await visitar(entrada);

  return { entrada, raiz, modulos };
}

/**
 * Ordena os módulos: dependência antes de quem depende.
 *
 * A travessia é em profundidade com três cores. `cinza` marca quem está no
 * caminho atual — reencontrar um cinza é exatamente a definição de ciclo, e é
 * daí que sai o caminho mostrado no erro.
 */
export function ordenar(grafo, { permitirCiclo = false } = {}) {
  const cor = new Map();
  const ordem = [];
  const ciclos = [];
  const caminhoAtual = [];

  const visitar = (caminho) => {
    const estado = cor.get(caminho);

    if (estado === 'preto') return;

    if (estado === 'cinza') {
      const inicio = caminhoAtual.indexOf(caminho);
      const ciclo = [...caminhoAtual.slice(inicio), caminho].map((c) => grafo.modulos.get(c).id);

      ciclos.push(ciclo);

      if (!permitirCiclo) {
        throw new ErroDeGrafo(`Dependência circular: ${ciclo.join(' → ')}.`, ciclo);
      }

      return;
    }

    cor.set(caminho, 'cinza');
    caminhoAtual.push(caminho);

    for (const alvo of grafo.modulos.get(caminho).dependencias.values()) visitar(alvo);

    caminhoAtual.pop();
    cor.set(caminho, 'preto');
    ordem.push(caminho);
  };

  visitar(grafo.entrada);

  return { ordem, ciclos };
}

/** Só os ciclos, sem levantar erro — usado pelo aviso da linha de comando. */
export function acharCiclos(grafo) {
  return ordenar(grafo, { permitirCiclo: true }).ciclos;
}

/** Quem importa quem, para o relatório. */
export function resumo(grafo) {
  const ordenado = ordenar(grafo, { permitirCiclo: true }).ordem;

  return ordenado.map((caminho) => {
    const modulo = grafo.modulos.get(caminho);

    return {
      id: modulo.id,
      bytes: Buffer.byteLength(modulo.codigo),
      dependeDe: [...modulo.dependencias.values()].map((c) => grafo.modulos.get(c).id),
    };
  });
}
