import ITENS, { descrever } from './catalogo.js';
import { Carrinho } from './carrinho.js';
import { moeda } from './formato.js';

console.log('Catálogo:');
for (const item of ITENS) console.log(`  ${descrever(item)}`);

const carrinho = new Carrinho().adicionar(ITENS[0], 2).adicionar(ITENS[2]);

console.log('\nCarrinho:');
for (const linha of carrinho.linhas()) console.log(`  ${linha}`);

console.log(`\nSubtotal: ${moeda(carrinho.subtotal)}`);
console.log(`Com 10% de desconto: ${moeda(carrinho.total(10))}`);
