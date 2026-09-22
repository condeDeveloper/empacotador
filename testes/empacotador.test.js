import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import { empacotar, empacotarPara } from '../src/empacotador.js';
import { ErroDeGrafo, acharCiclos, montarGrafo, ordenar, resumo } from '../src/grafo.js';
import { ErroDeResolucao, ehRelativo, identidade, resolver, tentar } from '../src/resolucao.js';
import { substituir } from '../src/transformacao.js';

const temporarios = [];

/** Escreve um projetinho em disco e devolve a raiz. */
async function projeto(arquivos) {
  const raiz = await mkdtemp(join(tmpdir(), 'empacotador-'));

  temporarios.push(raiz);

  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const cheio = join(raiz, ...caminho.split('/'));

    await mkdir(dirname(cheio), { recursive: true });
    await writeFile(cheio, conteudo, 'utf8');
  }

  return raiz;
}

/**
 * Roda um arquivo com o node e devolve o que ele imprimiu.
 *
 * `NO_COLOR` porque o `console.log` de um número sai com código de cor
 * quando o ambiente pede cor — e aí a comparação falha por um motivo que não
 * tem nada a ver com o empacotador.
 */
function rodar(caminho) {
  return execFileSync(process.execPath, [caminho], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  }).trim();
}

/** Empacota a entrada e roda o pacote, devolvendo a saída. */
async function empacotarERodar(raiz, entrada = 'principal.js', opcoes = {}) {
  const saida = join(raiz, 'pacote.js');

  await empacotarPara(join(raiz, entrada), saida, { raiz, ...opcoes });

  return rodar(saida);
}

after(async () => {
  for (const caminho of temporarios) await rm(caminho, { recursive: true, force: true });
});

describe('o pacote roda e faz a mesma coisa', () => {
  it('a saída do pacote é igual à do Node rodando os módulos direto', async () => {
    // É o teste que vale por dez: se estas duas saídas batem, a
    // transformação preservou o comportamento.
    const raiz = await projeto({
      'formato.js': 'export const moeda = (c) => `R$ ${(c / 100).toFixed(2)}`;\n',
      'soma.js': "import { moeda } from './formato.js';\nexport const total = (ns) => moeda(ns.reduce((a, b) => a + b, 0));\n",
      'principal.js': "import { total } from './soma.js';\nconsole.log(total([1990, 3890]));\n",
    });

    assert.equal(await empacotarERodar(raiz), rodar(join(raiz, 'principal.js')));
    assert.equal(await empacotarERodar(raiz), 'R$ 58.80');
  });

  it('exportação padrão, nomeada e renomeada atravessam', async () => {
    const raiz = await projeto({
      'a.js': 'const eu = "padrão";\nexport default eu;\nexport const um = 1;\nconst dois = 2;\nexport { dois as doisAlias };\n',
      'principal.js': "import padrao, { um, doisAlias } from './a.js';\nconsole.log(padrao, um, doisAlias);\n",
    });

    assert.equal(await empacotarERodar(raiz), rodar(join(raiz, 'principal.js')));
    assert.equal(await empacotarERodar(raiz), 'padrão 1 2');
  });

  it('espaço de nomes traz tudo, menos o padrão', async () => {
    // `import * as x` não inclui o default como uma chave qualquer, e
    // `export *` também não o repassa.
    const raiz = await projeto({
      'a.js': 'export default "escondido";\nexport const um = 1;\nexport const dois = 2;\n',
      'principal.js': "import * as tudo from './a.js';\nconsole.log(Object.keys(tudo).sort().join(','), tudo.padrao);\n",
    });

    // O padrão aparece na chave `padrao`, e não `default`: é o nome que
    // este empacotador usa por dentro, e o README avisa.
    assert.equal(await empacotarERodar(raiz), 'dois,padrao,um escondido');
  });

  it('reexportação com `export *` repassa os nomes', async () => {
    const raiz = await projeto({
      'a.js': 'export const um = 1;\nexport default "nao passa";\n',
      'b.js': "export * from './a.js';\nexport const dois = 2;\n",
      'principal.js': "import * as b from './b.js';\nconsole.log(Object.keys(b).sort().join(','));\n",
    });

    assert.equal(await empacotarERodar(raiz), 'dois,um');
  });

  it('reexportação nomeada e como espaço de nomes', async () => {
    const raiz = await projeto({
      'a.js': 'export const um = 1;\nexport const dois = 2;\n',
      'b.js': "export { um as primeiro } from './a.js';\nexport * as a from './a.js';\n",
      'principal.js': "import { primeiro, a } from './b.js';\nconsole.log(primeiro, a.dois);\n",
    });

    assert.equal(await empacotarERodar(raiz), '1 2');
  });

  it('import só por efeito colateral executa o módulo', async () => {
    const raiz = await projeto({
      'efeito.js': 'globalThis.__marca = "rodou";\n',
      'principal.js': "import './efeito.js';\nconsole.log(globalThis.__marca);\n",
    });

    assert.equal(await empacotarERodar(raiz), 'rodou');
  });

  it('o módulo compartilhado é executado uma vez só', async () => {
    // Se ele entrasse duas vezes, o contador imprimiria 1 e 1 em vez de 1 e 2.
    const raiz = await projeto({
      'contador.js': 'let n = 0;\nexport const proximo = () => ++n;\n',
      'a.js': "import { proximo } from './contador.js';\nexport const daA = proximo();\n",
      'b.js': "import { proximo } from './contador.js';\nexport const daB = proximo();\n",
      'principal.js': "import { daA } from './a.js';\nimport { daB } from './b.js';\nconsole.log(daA, daB);\n",
    });

    assert.equal(await empacotarERodar(raiz), rodar(join(raiz, 'principal.js')));
    assert.equal(await empacotarERodar(raiz), '1 2');
  });

  it('a exportação é um getter, então o espaço de nomes vê o valor novo', async () => {
    const raiz = await projeto({
      'estado.js': 'export let contador = 0;\nexport const somar = () => { contador += 1; };\n',
      'principal.js': "import * as estado from './estado.js';\nestado.somar();\nestado.somar();\nconsole.log(estado.contador);\n",
    });

    assert.equal(await empacotarERodar(raiz), rodar(join(raiz, 'principal.js')));
    assert.equal(await empacotarERodar(raiz), '2');
  });

  it('o formato nu sai sem a função que embrulha', async () => {
    const raiz = await projeto({
      'principal.js': "console.log('nu');\n",
    });

    const pacote = await empacotar(join(raiz, 'principal.js'), { raiz, formato: 'nu' });

    assert.ok(!pacote.codigo.startsWith('//'));
    assert.ok(!pacote.codigo.includes('})();'));
  });

  it('a palavra import num texto não vira dependência do pacote', async () => {
    const raiz = await projeto({
      'principal.js': "const aviso = 'use import em vez de require';\nconsole.log(aviso);\n",
    });

    const pacote = await empacotar(join(raiz, 'principal.js'), { raiz });

    assert.equal(pacote.modulos, 1);
    assert.equal(await empacotarERodar(raiz), 'use import em vez de require');
  });
});

describe('ordem e ciclos', () => {
  it('a dependência entra antes de quem depende', async () => {
    const raiz = await projeto({
      'base.js': 'export const b = 1;\n',
      'meio.js': "import { b } from './base.js';\nexport const m = b + 1;\n",
      'principal.js': "import { m } from './meio.js';\nconsole.log(m);\n",
    });

    const pacote = await empacotar(join(raiz, 'principal.js'), { raiz });

    assert.deepEqual(pacote.ordem, ['base.js', 'meio.js', 'principal.js']);
  });

  it('o módulo importado por dois entra uma vez só', async () => {
    const raiz = await projeto({
      'comum.js': 'export const c = 1;\n',
      'a.js': "import { c } from './comum.js';\nexport const a = c;\n",
      'b.js': "import { c } from './comum.js';\nexport const b = c;\n",
      'principal.js': "import { a } from './a.js';\nimport { b } from './b.js';\nconsole.log(a + b);\n",
    });

    const pacote = await empacotar(join(raiz, 'principal.js'), { raiz });

    assert.equal(pacote.ordem.filter((id) => id === 'comum.js').length, 1);
    assert.equal(pacote.modulos, 4);
  });

  it('o ciclo é recusado, dizendo qual é o caminho dele', async () => {
    // Melhor recusar do que emitir um pacote que quebra com `undefined`.
    const raiz = await projeto({
      'a.js': "import { b } from './b.js';\nexport const a = () => b();\n",
      'b.js': "import { a } from './a.js';\nexport const b = () => a();\n",
      'principal.js': "import { a } from './a.js';\nconsole.log(typeof a);\n",
    });

    await assert.rejects(() => empacotar(join(raiz, 'principal.js'), { raiz }), ErroDeGrafo);

    try {
      await empacotar(join(raiz, 'principal.js'), { raiz });
    } catch (erro) {
      assert.deepEqual(erro.ciclo, ['a.js', 'b.js', 'a.js']);
      assert.match(erro.message, /a\.js → b\.js → a\.js/);
    }
  });

  it('com --ciclos o pacote sai e o ciclo vira aviso', async () => {
    const raiz = await projeto({
      'a.js': "import { b } from './b.js';\nexport const a = 'A';\nexport const usar = () => b;\n",
      'b.js': "import { a } from './a.js';\nexport const b = 'B';\n",
      'principal.js': "import { usar } from './a.js';\nconsole.log(usar());\n",
    });

    const pacote = await empacotar(join(raiz, 'principal.js'), { raiz, permitirCiclo: true });

    assert.equal(pacote.ciclos.length, 1);
    assert.ok(pacote.codigo.includes('__registro'));
  });

  it('o módulo que importa a si mesmo também é um ciclo', async () => {
    const raiz = await projeto({
      'principal.js': "import { x } from './principal.js';\nexport const x = 1;\n",
    });

    await assert.rejects(() => empacotar(join(raiz, 'principal.js'), { raiz }), /circular/);
  });

  it('o resumo lista quem depende de quem', async () => {
    const raiz = await projeto({
      'base.js': 'export const b = 1;\n',
      'principal.js': "import { b } from './base.js';\nconsole.log(b);\n",
    });

    const linhas = resumo(await montarGrafo(join(raiz, 'principal.js'), { raiz }));

    assert.deepEqual(linhas.at(-1).dependeDe, ['base.js']);
    assert.ok(linhas.every((l) => l.bytes > 0));
  });

  it('acharCiclos não levanta erro', async () => {
    const raiz = await projeto({
      'a.js': "import './b.js';\n",
      'b.js': "import './a.js';\n",
      'principal.js': "import './a.js';\nconsole.log('ok');\n",
    });

    assert.equal(acharCiclos(await montarGrafo(join(raiz, 'principal.js'), { raiz })).length, 1);
  });

  it('ordenar duas vezes dá a mesma ordem', async () => {
    const raiz = await projeto({
      'a.js': 'export const a = 1;\n',
      'b.js': 'export const b = 2;\n',
      'principal.js': "import { a } from './a.js';\nimport { b } from './b.js';\nconsole.log(a + b);\n",
    });

    const grafo = await montarGrafo(join(raiz, 'principal.js'), { raiz });

    assert.deepEqual(ordenar(grafo).ordem, ordenar(grafo).ordem);
  });
});

describe('resolução', () => {
  it('reconhece o que é relativo', () => {
    assert.equal(ehRelativo('./a.js'), true);
    assert.equal(ehRelativo('../a.js'), true);
    assert.equal(ehRelativo('lodash'), false);
    assert.equal(ehRelativo('node:fs'), false);
  });

  it('completa a extensão e o índice da pasta', async () => {
    // É a resolução de empacotador, mais folgada que a do Node ESM.
    const raiz = await projeto({
      'sem-extensao.js': 'export const a = 1;\n',
      'pasta/index.js': 'export const b = 2;\n',
      'principal.js': 'console.log(1);\n',
    });

    const daqui = join(raiz, 'principal.js');

    assert.equal(resolver('./sem-extensao', daqui), resolve(raiz, 'sem-extensao.js'));
    assert.equal(resolver('./pasta', daqui), resolve(raiz, 'pasta', 'index.js'));
    assert.equal(resolver('./pasta/index.js', daqui), resolve(raiz, 'pasta', 'index.js'));
  });

  it('pacote instalado é recusado com um motivo claro', async () => {
    const raiz = await projeto({ 'principal.js': 'console.log(1);\n' });

    assert.throws(() => resolver('lodash', join(raiz, 'principal.js')), ErroDeResolucao);
    assert.throws(() => resolver('lodash', join(raiz, 'principal.js')), /Só caminhos relativos/);
  });

  it('arquivo que não existe diz o que foi tentado', async () => {
    const raiz = await projeto({ 'principal.js': 'console.log(1);\n' });

    assert.throws(() => resolver('./fantasma.js', join(raiz, 'principal.js')), /Não achei "\.\/fantasma\.js"/);
  });

  it('caminho inexistente não vira arquivo', () => {
    assert.equal(tentar(join(tmpdir(), 'nao-existe-mesmo-12345')), null);
  });

  it('a identidade usa barra em qualquer sistema', () => {
    assert.equal(identidade(join('/raiz', 'src', 'a.js'), '/raiz'), 'src/a.js');
  });
});

describe('substituição de trechos', () => {
  it('aplica de trás para a frente, para os índices não andarem', () => {
    // Trocando da esquerda para a direita, a segunda posição já estaria errada.
    const trocado = substituir('AAABBBCCC', [
      { inicio: 0, fim: 3, texto: 'x' },
      { inicio: 6, fim: 9, texto: 'z' },
    ]);

    assert.equal(trocado, 'xBBBz');
  });

  it('sem trocas devolve o mesmo texto', () => {
    assert.equal(substituir('nada muda', []), 'nada muda');
  });
});
