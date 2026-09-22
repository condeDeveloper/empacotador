import { moeda } from './formato.js';

const ITENS = [
  { codigo: 'caf', nome: 'Café em grãos', preco: 3890 },
  { codigo: 'moe', nome: 'Moedor manual', preco: 12500 },
  { codigo: 'fil', nome: 'Filtro de pano', preco: 1990 },
];

export default ITENS;

export function descrever(item) {
  return `${item.nome} — ${moeda(item.preco)}`;
}
