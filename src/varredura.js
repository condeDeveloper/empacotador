/**
 * A varredura — a parte que quase todo tutorial de empacotador erra.
 *
 * O primeiro instinto para achar os `import` de um arquivo é uma expressão
 * regular. Ela funciona nos exemplos e falha em código real, porque a palavra
 * `import` aparece em lugares onde não é um import:
 *
 *     // import antigo, remover depois
 *     const aviso = 'use import em vez de require';
 *     const url = `${base}/import/${id}`;
 *     const regra = /import\s+.*way/;
 *
 * A solução aqui é montar uma **sombra**: uma cópia do código, do mesmo
 * tamanho, em que todo caractere dentro de texto, comentário, gabarito ou
 * expressão regular vira espaço. Quebras de linha são preservadas, para que o
 * número da linha continue batendo.
 *
 * Como a sombra tem exatamente o mesmo comprimento do original, dá para
 * procurar nela e **recortar do original** — as posições coincidem. É um
 * analisador de verdade só para a parte que precisa ser exata, e nada mais.
 */

/** Caracteres que, antes de uma barra, indicam divisão e não expressão regular. */
const ANTES_DE_DIVISAO = /[)\]}\w$]/;

/** O código não pôde ser varrido. */
export class ErroDeVarredura extends Error {
  constructor(mensagem, posicao) {
    super(mensagem);
    this.name = 'ErroDeVarredura';
    this.posicao = posicao;
  }
}

/**
 * Devolve a sombra do código: mesmo tamanho, com o conteúdo "inerte" apagado.
 *
 * @param {string} codigo
 * @returns {string}
 */
export function sombra(codigo) {
  const resultado = codigo.split('');

  /** Apaga um trecho, mantendo as quebras de linha no lugar. */
  const apagar = (inicio, fim) => {
    for (let i = inicio; i < fim && i < resultado.length; i += 1) {
      if (resultado[i] !== '\n') resultado[i] = ' ';
    }
  };

  let i = 0;
  let anterior = '';

  while (i < codigo.length) {
    const c = codigo[i];
    const proximo = codigo[i + 1];

    // ---------------------------------------------------------- comentários
    if (c === '/' && proximo === '/') {
      const fim = codigo.indexOf('\n', i);

      apagar(i, fim < 0 ? codigo.length : fim);
      i = fim < 0 ? codigo.length : fim;
      continue;
    }

    if (c === '/' && proximo === '*') {
      const fim = codigo.indexOf('*/', i + 2);

      if (fim < 0) throw new ErroDeVarredura('Comentário de bloco sem fechamento.', i);

      apagar(i, fim + 2);
      i = fim + 2;
      continue;
    }

    // --------------------------------------------------------------- textos
    if (c === '"' || c === "'") {
      const fim = fimDoTexto(codigo, i, c);

      apagar(i + 1, fim);
      i = fim + 1;
      anterior = c;
      continue;
    }

    // ------------------------------------------------------------- gabarito
    if (c === '`') {
      // Um gabarito pode ter `${...}` com código dentro, e esse código pode
      // ter outro gabarito. Apagar o gabarito inteiro esconderia um import
      // legítimo dentro da interpolação.
      i = varrerGabarito(codigo, i, apagar);
      anterior = '`';
      continue;
    }

    // ---------------------------------------------------- expressão regular
    if (c === '/' && !ANTES_DE_DIVISAO.test(anterior)) {
      const fim = fimDaRegular(codigo, i);

      if (fim > 0) {
        apagar(i + 1, fim);
        i = fim + 1;
        anterior = '/';
        continue;
      }
    }

    if (!/\s/.test(c)) anterior = c;

    i += 1;
  }


  return resultado.join('');
}

/** Acha o fim de um texto entre aspas, respeitando a barra de escape. */
function fimDoTexto(codigo, inicio, aspas) {
  for (let i = inicio + 1; i < codigo.length; i += 1) {
    if (codigo[i] === '\\') {
      i += 1;
      continue;
    }

    if (codigo[i] === aspas) return i;

    // Texto normal não atravessa linha; se atravessou, o arquivo está
    // quebrado e é melhor dizer isso do que varrer o resto errado.
    if (codigo[i] === '\n') throw new ErroDeVarredura('Texto sem fechamento na mesma linha.', inicio);
  }

  throw new ErroDeVarredura('Texto sem fechamento.', inicio);
}

/**
 * Varre um gabarito, preservando o código dentro de `${...}`.
 *
 * Devolve a posição logo depois da crase final.
 */
function varrerGabarito(codigo, inicio, apagar) {
  let i = inicio + 1;
  let trecho = i;

  while (i < codigo.length) {
    if (codigo[i] === '\\') {
      i += 2;
      continue;
    }

    if (codigo[i] === '`') {
      apagar(trecho, i);

      return i + 1;
    }

    if (codigo[i] === '$' && codigo[i + 1] === '{') {
      apagar(trecho, i);

      const fim = fimDaInterpolacao(codigo, i + 1);

      i = fim + 1;
      trecho = i;
      continue;
    }

    i += 1;
  }

  throw new ErroDeVarredura('Gabarito sem fechamento.', inicio);
}

/** Acha a chave que fecha um `${`, contando as de dentro. */
function fimDaInterpolacao(codigo, abre) {
  let nivel = 0;

  for (let i = abre; i < codigo.length; i += 1) {
    if (codigo[i] === '{') nivel += 1;
    else if (codigo[i] === '}') {
      nivel -= 1;

      if (nivel === 0) return i;
    }
  }

  throw new ErroDeVarredura('Interpolação sem fechamento.', abre);
}

/** Acha a barra que fecha uma expressão regular. Devolve -1 se não era uma. */
function fimDaRegular(codigo, inicio) {
  let dentroDeClasse = false;

  for (let i = inicio + 1; i < codigo.length; i += 1) {
    const c = codigo[i];

    if (c === '\\') {
      i += 1;
      continue;
    }

    // Dentro de `[...]` uma barra não termina nada: `/[/]/` é válido.
    if (c === '[') dentroDeClasse = true;
    else if (c === ']') dentroDeClasse = false;
    else if (c === '/' && !dentroDeClasse) return i;
    else if (c === '\n') return -1;
  }

  return -1;
}

/** Converte uma posição em linha e coluna, para a mensagem de erro servir. */
export function posicaoLegivel(codigo, indice) {
  const antes = codigo.slice(0, indice);
  const linha = antes.split('\n').length;
  const coluna = indice - (antes.lastIndexOf('\n') + 1) + 1;

  return { linha, coluna };
}
