#!/usr/bin/env node
/**
 * A linha de comando.
 *
 * Traduz argumentos em chamadas e formata o relatório. Toda a decisão está na
 * biblioteca.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { empacotar, empacotarPara } from './empacotador.js';
import { montarGrafo, resumo } from './grafo.js';

const AJUDA = `empacotador — módulos ES num arquivo só

  empacotar <entrada.js>              escreve o pacote na saída padrão
  empacotar <entrada.js> -s pacote.js grava num arquivo
  empacotar <entrada.js> --grafo      mostra o grafo em vez de empacotar
  empacotar <entrada.js> --ciclos     empacota mesmo com dependência circular
  empacotar <entrada.js> --nu         sem a função que embrulha tudo

  -r, --raiz <pasta>   base dos nomes dos módulos (padrão: onde você está)
  -h, --ajuda          isto aqui`;

/** Lê os argumentos. */
export function lerArgumentos(argumentos) {
  const opcoes = {
    entrada: null,
    saida: null,
    raiz: process.cwd(),
    grafo: false,
    permitirCiclo: false,
    formato: 'iife',
    ajuda: false,
  };

  for (let i = 0; i < argumentos.length; i += 1) {
    const arg = argumentos[i];

    if (arg === '-h' || arg === '--ajuda') opcoes.ajuda = true;
    else if (arg === '--grafo') opcoes.grafo = true;
    else if (arg === '--ciclos') opcoes.permitirCiclo = true;
    else if (arg === '--nu') opcoes.formato = 'nu';
    else if (arg === '-s' || arg === '--saida') {
      opcoes.saida = argumentos[++i];

      if (!opcoes.saida) throw new Error('Faltou o arquivo depois de -s.');
    } else if (arg === '-r' || arg === '--raiz') {
      const valor = argumentos[++i];

      if (!valor) throw new Error('Faltou a pasta depois de -r.');

      opcoes.raiz = resolve(valor);
    } else if (arg.startsWith('-')) {
      throw new Error(`Opção desconhecida: ${arg}.`);
    } else if (opcoes.entrada === null) {
      opcoes.entrada = arg;
    } else {
      throw new Error(`Só uma entrada por vez; recebi também "${arg}".`);
    }
  }

  return opcoes;
}

/** Desenha o grafo em texto. */
export function desenharGrafo(linhas) {
  const saida = [];

  for (const modulo of linhas) {
    saida.push(`${modulo.id}  (${modulo.bytes} bytes)`);

    for (const dependencia of modulo.dependeDe) saida.push(`    → ${dependencia}`);
  }

  return saida.join('\n');
}

/** Roda um comando e devolve o código de saída. */
export async function principal(argumentos, escrever = console.log) {
  let opcoes;

  try {
    opcoes = lerArgumentos(argumentos);
  } catch (erro) {
    escrever(erro.message);
    return 2;
  }

  if (opcoes.ajuda || opcoes.entrada === null) {
    escrever(AJUDA);
    return opcoes.ajuda ? 0 : 2;
  }

  try {
    if (opcoes.grafo) {
      const grafo = await montarGrafo(resolve(opcoes.entrada), { raiz: opcoes.raiz });

      escrever(desenharGrafo(resumo(grafo)));

      return 0;
    }

    if (opcoes.saida === null) {
      const pacote = await empacotar(opcoes.entrada, opcoes);

      escrever(pacote.codigo);

      return 0;
    }

    const pacote = await empacotarPara(opcoes.entrada, opcoes.saida, opcoes);

    escrever(`${pacote.saida}: ${pacote.modulos} módulo(s), ${pacote.bytes} bytes.`);

    for (const ciclo of pacote.ciclos) escrever(`  aviso: dependência circular ${ciclo.join(' → ')}`);

    return 0;
  } catch (erro) {
    escrever(erro.message);

    // Ciclo tem conserto na mão de quem escreveu o código; vale um código de
    // saída próprio para um script conseguir distinguir.
    return erro.name === 'ErroDeGrafo' ? 3 : 1;
  }
}

/* c8 ignore start */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
/* c8 ignore stop */
