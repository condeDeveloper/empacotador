import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { desenharGrafo, lerArgumentos, principal } from '../src/cli.js';

const temporarios = [];

/** Um projetinho de dois arquivos. */
async function projeto() {
  const raiz = await mkdtemp(join(tmpdir(), 'empacotador-cli-'));

  temporarios.push(raiz);

  await writeFile(join(raiz, 'base.js'), 'export const b = 7;\n');
  await writeFile(join(raiz, 'principal.js'), "import { b } from './base.js';\nconsole.log(b);\n");

  return raiz;
}

/** Roda a linha de comando e devolve código e saída. */
async function rodar(argumentos) {
  const linhas = [];
  const codigo = await principal(argumentos, (linha) => linhas.push(String(linha)));

  return { codigo, saida: linhas.join('\n') };
}

after(async () => {
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
});

describe('argumentos', () => {
  it('lê entrada, saída e raiz', () => {
    const opcoes = lerArgumentos(['entrada.js', '-s', 'pacote.js', '-r', '.']);

    assert.equal(opcoes.entrada, 'entrada.js');
    assert.equal(opcoes.saida, 'pacote.js');
    assert.equal(opcoes.raiz, process.cwd());
  });

  it('lê as bandeiras', () => {
    const opcoes = lerArgumentos(['a.js', '--grafo', '--ciclos', '--nu']);

    assert.equal(opcoes.grafo, true);
    assert.equal(opcoes.permitirCiclo, true);
    assert.equal(opcoes.formato, 'nu');
  });

  it('recusa opção desconhecida, valor faltando e entrada dobrada', () => {
    assert.throws(() => lerArgumentos(['--inventada']), /desconhecida/);
    assert.throws(() => lerArgumentos(['a.js', '-s']), /Faltou o arquivo/);
    assert.throws(() => lerArgumentos(['a.js', '-r']), /Faltou a pasta/);
    assert.throws(() => lerArgumentos(['a.js', 'b.js']), /Só uma entrada/);
  });
});

describe('comandos', () => {
  it('sem entrada mostra a ajuda e sai com 2', async () => {
    const { codigo, saida } = await rodar([]);

    assert.equal(codigo, 2);
    assert.match(saida, /empacotador/);
  });

  it('--ajuda sai com 0', async () => {
    assert.equal((await rodar(['--ajuda'])).codigo, 0);
  });

  it('opção inválida sai com 2', async () => {
    assert.equal((await rodar(['--inventada'])).codigo, 2);
  });

  it('sem -s o pacote sai na saída padrão', async () => {
    const raiz = await projeto();
    const { codigo, saida } = await rodar([join(raiz, 'principal.js'), '-r', raiz]);

    assert.equal(codigo, 0);
    assert.match(saida, /__registro/);
    assert.match(saida, /__exigir\("principal\.js"\)/);
  });

  it('com -s grava o arquivo e relata', async () => {
    const raiz = await projeto();
    const alvo = join(raiz, 'pacote.js');

    const { codigo, saida } = await rodar([join(raiz, 'principal.js'), '-s', alvo, '-r', raiz]);

    assert.equal(codigo, 0);
    assert.match(saida, /2 módulo\(s\)/);
    assert.match(await readFile(alvo, 'utf8'), /__registro/);
  });

  it('--grafo mostra quem depende de quem', async () => {
    const raiz = await projeto();
    const { codigo, saida } = await rodar([join(raiz, 'principal.js'), '--grafo', '-r', raiz]);

    assert.equal(codigo, 0);
    assert.match(saida, /base\.js {2}\(\d+ bytes\)/);
    assert.match(saida, /→ base\.js/);
  });

  it('entrada que não existe sai com 1', async () => {
    const { codigo, saida } = await rodar(['./nao-existe.js']);

    assert.equal(codigo, 1);
    assert.ok(saida.length > 0);
  });

  it('ciclo tem código de saída próprio, para um script distinguir', async () => {
    const raiz = await mkdtemp(join(tmpdir(), 'empacotador-ciclo-'));

    temporarios.push(raiz);

    await writeFile(join(raiz, 'a.js'), "import './b.js';\nexport const a = 1;\n");
    await writeFile(join(raiz, 'b.js'), "import './a.js';\nexport const b = 2;\n");

    const { codigo, saida } = await rodar([join(raiz, 'a.js'), '-r', raiz]);

    assert.equal(codigo, 3);
    assert.match(saida, /circular/);

    const comCiclo = await rodar([join(raiz, 'a.js'), '-r', raiz, '--ciclos', '-s', join(raiz, 'p.js')]);

    assert.equal(comCiclo.codigo, 0);
    assert.match(comCiclo.saida, /aviso: dependência circular/);
  });
});

describe('desenho do grafo', () => {
  it('lista o módulo e o que ele importa', () => {
    const texto = desenharGrafo([
      { id: 'base.js', bytes: 10, dependeDe: [] },
      { id: 'principal.js', bytes: 20, dependeDe: ['base.js'] },
    ]);

    assert.equal(texto, 'base.js  (10 bytes)\nprincipal.js  (20 bytes)\n    → base.js');
  });
});
