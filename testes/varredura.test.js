import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ErroDeVarredura, posicaoLegivel, sombra } from '../src/varredura.js';
import { analisar, lerClausula, lerEspecificadores } from '../src/analise.js';

/** Os especificadores que a análise encontrou, em ordem. */
const importados = (codigo) => analisar(codigo).importacoes.map((i) => i.especificador);

describe('a sombra', () => {
  it('tem exatamente o mesmo comprimento do original', () => {
    // É o que faz `match.index` valer para os dois.
    const codigo = "const a = 'texto'; // comentário\nconst b = `gabarito ${a}`;\n";

    assert.equal(sombra(codigo).length, codigo.length);
  });

  it('preserva as quebras de linha, para o número da linha continuar certo', () => {
    const codigo = "/* um\ncomentário\nde três linhas */\nimport a from './a.js';\n";
    const inerte = sombra(codigo);

    assert.equal(inerte.split('\n').length, codigo.split('\n').length);
    assert.equal(posicaoLegivel(codigo, inerte.indexOf('import')).linha, 4);
  });

  it('apaga o miolo do texto mas mantém as aspas', () => {
    // As aspas ficam para a análise achar onde recortar o caminho.
    assert.equal(sombra("const a = 'oi';"), "const a = '  ';");
    assert.equal(sombra('const a = "oi";'), 'const a = "  ";');
  });

  it('respeita a barra de escape dentro do texto', () => {
    const codigo = "const a = 'não \\' acabou aqui'; const b = 1;";

    assert.match(sombra(codigo), /const b = 1;$/);
  });

  it('apaga comentário de linha e de bloco', () => {
    assert.equal(sombra('a; // b\nc;'), 'a;     \nc;');
    assert.equal(sombra('a; /* b */ c;'), 'a;         c;');
  });

  it('preserva o código dentro de `${}` do gabarito', () => {
    // Apagar o gabarito inteiro esconderia um import legítimo na interpolação.
    const codigo = 'const x = `antes ${ importante } depois`;';
    const inerte = sombra(codigo);

    assert.ok(inerte.includes('importante'));
    assert.ok(!inerte.includes('antes'));
    assert.ok(!inerte.includes('depois'));
  });

  it('aguenta gabarito dentro de gabarito', () => {
    const codigo = 'const x = `a ${ `b ${ c } d` } e`;';

    assert.ok(sombra(codigo).includes('c'));
    assert.equal(sombra(codigo).length, codigo.length);
  });

  it('apaga o corpo de uma expressão regular', () => {
    assert.equal(sombra('const r = /import x/;'), 'const r = /        /;');
  });

  it('barra dentro de classe de caracteres não fecha a regular', () => {
    const codigo = 'const r = /[/]x/; const depois = 1;';

    assert.match(sombra(codigo), /const depois = 1;$/);
  });

  it('divisão não é confundida com expressão regular', () => {
    // `a / b / c` são duas divisões, não uma regular no meio.
    const codigo = 'const m = a / b / c; const nome = 2;';

    assert.equal(sombra(codigo), codigo);
  });

  it('reclama do que não fecha, em vez de varrer o resto errado', () => {
    assert.throws(() => sombra("const a = 'sem fim"), ErroDeVarredura);
    assert.throws(() => sombra('/* sem fim'), /Comentário de bloco/);
    assert.throws(() => sombra('const a = `sem fim'), /Gabarito/);
    assert.throws(() => sombra("const a = 'quebra\nlinha';"), /mesma linha/);
  });
});

describe('a palavra import onde ela não é um import', () => {
  it('em comentário de linha', () => {
    assert.deepEqual(importados("// import antigo from './velho.js'\nimport a from './novo.js';"), ['./novo.js']);
  });

  it('em comentário de bloco', () => {
    assert.deepEqual(importados("/*\nimport a from './velho.js';\n*/\nimport b from './novo.js';"), ['./novo.js']);
  });

  it('dentro de um texto', () => {
    assert.deepEqual(importados("const aviso = 'use import em vez de require';"), []);
  });

  it('dentro de um gabarito', () => {
    assert.deepEqual(importados('const url = `${base}/import/${id}`;'), []);
  });

  it('dentro de uma expressão regular', () => {
    assert.deepEqual(importados("const regra = /import\\s+.*/;"), []);
  });

  it('como parte de outro identificador', () => {
    // `reimportar` e `x.import` não são declarações de importação.
    assert.deepEqual(importados("const reimportar = 1; objeto.import = './a.js';"), []);
  });

  it('e o import de verdade logo abaixo continua sendo achado', () => {
    const codigo = [
      "// import a from './comentario.js';",
      "const t = 'import b from \"./texto.js\"';",
      "const r = /import c from '.\\/regex.js'/;",
      "import d from './real.js';",
    ].join('\n');

    assert.deepEqual(importados(codigo), ['./real.js']);
  });
});

describe('formas de import', () => {
  it('padrão, nomeado, espaço de nomes e só efeito', () => {
    const analise = analisar(
      [
        "import padrao from './a.js';",
        "import { um, dois as doisAlias } from './b.js';",
        "import * as tudo from './c.js';",
        "import './d.js';",
        "import misto, { parte } from './e.js';",
        "import outro, * as espaco from './f.js';",
      ].join('\n'),
    );

    const por = (caminho) => analise.importacoes.find((i) => i.especificador === caminho);

    assert.equal(por('./a.js').padrao, 'padrao');
    assert.deepEqual(por('./b.js').nomes, [
      { esquerda: 'um', direita: 'um' },
      { esquerda: 'dois', direita: 'doisAlias' },
    ]);
    assert.equal(por('./c.js').espacoDeNomes, 'tudo');
    assert.deepEqual(por('./d.js').nomes, []);
    assert.equal(por('./e.js').padrao, 'misto');
    assert.equal(por('./e.js').nomes[0].esquerda, 'parte');
    assert.equal(por('./f.js').padrao, 'outro');
    assert.equal(por('./f.js').espacoDeNomes, 'espaco');
  });

  it('import em várias linhas', () => {
    const codigo = "import {\n  um,\n  dois,\n} from './a.js';";

    assert.deepEqual(analisar(codigo).importacoes[0].nomes.map((n) => n.esquerda), ['um', 'dois']);
  });

  it('aspas duplas funcionam igual', () => {
    assert.deepEqual(importados('import a from "./a.js";'), ['./a.js']);
  });

  it('import dinâmico é registrado à parte', () => {
    const analise = analisar("const tarde = () => import('./preguicoso.js');");

    assert.deepEqual(analise.importacoes, []);
    assert.equal(analise.dinamicas[0].especificador, './preguicoso.js');
  });
});

describe('formas de export', () => {
  it('declaração, lista, padrão e reexportação', () => {
    const analise = analisar(
      [
        'export const um = 1;',
        'export let dois = 2;',
        'export function tres() {}',
        'export class Quatro {}',
        'export async function cinco() {}',
        'const seis = 6;',
        'export { seis, seis as meiaDuzia };',
        'export default 7;',
        "export { oito } from './outro.js';",
        "export * from './tudo.js';",
        "export * as nove from './espaco.js';",
      ].join('\n'),
    );

    const tipos = analise.exportacoes.map((e) => e.tipo);

    assert.deepEqual(
      analise.exportacoes.filter((e) => e.tipo === 'declaracao').map((e) => e.nome),
      ['um', 'dois', 'tres', 'Quatro', 'cinco'],
    );
    assert.ok(tipos.includes('padrao'));
    assert.ok(tipos.includes('tudo'));
    assert.ok(tipos.includes('espacoDeNomes'));
    assert.equal(analise.exportacoes.find((e) => e.tipo === 'reexporta').especificador, './outro.js');
  });

  it('`export { a } from` não conta duas vezes', () => {
    // A lista simples casaria com a mesma posição se não fosse o descarte.
    const analise = analisar("export { a } from './x.js';");

    assert.equal(analise.exportacoes.length, 1);
    assert.equal(analise.exportacoes[0].tipo, 'reexporta');
  });

  it('o `as` significa coisas opostas nos dois lados', () => {
    // import { a as b }: `a` é o nome lá fora. export { a as b }: aqui dentro.
    assert.deepEqual(lerEspecificadores('a as b'), [{ esquerda: 'a', direita: 'b' }]);
    assert.deepEqual(lerEspecificadores('a'), [{ esquerda: 'a', direita: 'a' }]);
    assert.deepEqual(lerEspecificadores(''), []);
  });

  it('cláusula vazia não quebra', () => {
    assert.deepEqual(lerClausula('{}'), { padrao: null, espacoDeNomes: null, nomes: [] });
  });
});
