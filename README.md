# empacotador

Um empacotador de módulos ES escrito do zero: varredura do código, grafo de
dependências, ordem topológica e um arquivo só na saída. **Zero dependências.**

```bash
$ empacotar exemplos/loja/principal.js --grafo
exemplos/loja/formato.js  (270 bytes)
exemplos/loja/catalogo.js  (343 bytes)
    → exemplos/loja/formato.js
exemplos/loja/util/index.js  (227 bytes)
exemplos/loja/carrinho.js  (626 bytes)
    → exemplos/loja/formato.js
    → exemplos/loja/util/index.js
exemplos/loja/principal.js  (516 bytes)
    → exemplos/loja/catalogo.js
    → exemplos/loja/carrinho.js
    → exemplos/loja/formato.js

$ empacotar exemplos/loja/principal.js -s pacote.js
pacote.js: 5 módulo(s), 4038 bytes.

$ node pacote.js
Catálogo:
  Café em grãos — R$ 38,90
  Moedor manual — R$ 125,00
  Filtro de pano — R$ 19,90

Carrinho:
  2x Café em grãos — R$ 77,80
  1x Filtro de pano — R$ 19,90

Subtotal: R$ 97,70
Com 10% de desconto: R$ 87,93
```

A mesma saída que `node exemplos/loja/principal.js` — e há um teste que compara
as duas.

## Por que existe

Empacotador tem fama de caixa-preta de dez mil linhas. O **núcleo** são quatro
passos, e cada um esconde uma decisão que o primeiro instinto erra.

### 1. Não dá para achar `import` com expressão regular

É o primeiro instinto e falha no primeiro arquivo real, porque a palavra
aparece onde não é um import:

```js
// import antigo, remover depois
const aviso = 'use import em vez de require';
const url = `${base}/import/${id}`;
const regra = /import\s+.*/;
```

A saída aqui é montar uma **sombra**: uma cópia do código, do mesmo tamanho,
em que todo caractere dentro de texto, comentário, gabarito ou expressão
regular vira espaço — com as quebras de linha preservadas, para o número da
linha continuar batendo.

Como a sombra tem exatamente o mesmo comprimento, dá para procurar nela e
**recortar do original**: as posições coincidem. É análise de verdade só na
parte que precisa ser exata, e nada mais.

O detalhe mais delicado dessa varredura é distinguir `/` de divisão de `/` de
expressão regular. E o gabarito não pode ser apagado inteiro: o código dentro
de `${...}` é código, e pode ter um import de verdade.

### 2. Dois caminhos para o mesmo arquivo viram dois módulos

`./util/soma.js` e `../loja/util/soma.js` são o mesmo arquivo. Se a identidade
do módulo for o texto do especificador, ele entra duas vezes no pacote — e aí
o `Set` criado lá dentro passa a ter duas instâncias que não se enxergam. É um
bug que aparece como "meu estado sumiu" e leva horas.

Por isso a identidade é sempre o caminho absoluto resolvido.

### 3. Um arquivo executa de cima para baixo

O pacote é um arquivo só, então a ordem importa: quem é importado vem antes de
quem importa. Isso é ordenação topológica, feita com busca em profundidade e
três cores.

### 4. E aí aparece o ciclo

`a.js` importa `b.js`, que importa `a.js` de volta. Não existe ordem que
satisfaça os dois. Módulos ES resolvem isso com ligações vivas; um pacote
simples não tem como.

O que dá para fazer — e é o que este faz — é **detectar** e dizer qual é o
caminho do ciclo:

```
Dependência circular: a.js → b.js → a.js.
```

Melhor do que emitir um pacote que quebra em produção com
`undefined is not a function`. Com `--ciclos` ele sai mesmo assim, como aviso.

O `__cache` é gravado **antes** de o módulo rodar. Sem isso, um ciclo entraria
em recursão infinita em vez de devolver um objeto meio pronto.

### 5. Exportação é getter, não cópia

Cada módulo vira uma função, e o corpo continua exatamente o mesmo — só as
bordas mudam:

```js
__registro["formato.js"] = (__modulo, __exigir) => {
  const moeda = (centavos) => REAIS.format(centavos / 100);

  __definir(__modulo, "moeda", () => moeda);
};
```

As exportações são `Object.defineProperty` com `get`, então quem lê pelo
espaço de nomes enxerga o valor novo depois de um `let` ser reatribuído.

## Comandos

```
empacotar <entrada.js>               escreve o pacote na saída padrão
empacotar <entrada.js> -s pacote.js  grava num arquivo
empacotar <entrada.js> --grafo       mostra o grafo em vez de empacotar
empacotar <entrada.js> --ciclos      empacota mesmo com dependência circular
empacotar <entrada.js> --nu          sem a função que embrulha tudo
  -r, --raiz <pasta>   base dos nomes dos módulos
```

Códigos de saída: `0` deu certo, `1` erro, `2` argumento inválido e `3`
dependência circular — separado para um script conseguir distinguir.

## Como biblioteca

```js
import { empacotar, montarGrafo, sombra } from 'empacotador';

const pacote = await empacotar('src/principal.js', { raiz: process.cwd() });

console.log(pacote.ordem);   // ['util.js', 'loja.js', 'principal.js']
console.log(pacote.modulos); // 3

sombra("const a = 'import x';"); // "const a = '        ';"
```

## Estrutura

```
src/varredura.js      a sombra: apaga texto, comentário, gabarito e regular
src/analise.js        acha os import e export, sobre a sombra
src/resolucao.js      especificador → caminho absoluto único
src/grafo.js          dependências, ordem topológica e detecção de ciclo
src/transformacao.js  reescreve as bordas do módulo
src/empacotador.js    o registro, o `exigir` e a montagem final
src/cli.js            argumentos, relatório e códigos de saída
```

## Rodando

```bash
npm test         # 64 testes
npm run exemplo  # empacota a loja de exemplo
```

Os testes de ponta a ponta escrevem um projetinho em disco, empacotam, **rodam
o pacote com o node** e comparam a saída com a de rodar os módulos ES direto.
É o teste que vale por dez: se as duas batem, a transformação preservou o
comportamento.

Node 20 ou mais novo.

## Limites conhecidos

- **Sem `node_modules`.** Só caminho relativo. Resolver pacote instalado é um
  algoritmo inteiro à parte, com `exports`, `imports` e condições.
- **A importação copia o valor.** `import { a }` vira `const a = m.a`, e
  `const` não pode ser getter. Reatribuir um `let` exportado é visto por quem
  lê pelo espaço de nomes, não por quem importou o nome solto. Um teste
  documenta exatamente isso.
- **O padrão se chama `padrao` por dentro.** No espaço de nomes a chave é
  `padrao`, e não `default`.
- **Sem remoção de código morto.** Tudo que é alcançado pelo grafo entra, usado
  ou não. Isso exige análise de escopo, que exige um analisador sintático de
  verdade.
- **Sem minificação, sem mapa de origem, sem divisão em pedaços.**
- **`import()` dinâmico é reconhecido mas não empacotado** — ele continua no
  código como estava.
- **A resolução é mais folgada que a do Node ESM**: aceita `./util` e
  `./util/index.js`, que o Node puro recusa. É o comportamento de empacotador,
  não o da especificação.
- A varredura não é um analisador sintático. Ela acerta as bordas do módulo;
  código que confunde `/` de divisão com expressão regular em posição bizarra
  pode escapar.

## Licença

MIT.
