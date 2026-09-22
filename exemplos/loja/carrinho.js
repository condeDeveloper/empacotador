import { moeda } from './formato.js';
import { porcentagem, somar } from './util/index.js';

export class Carrinho {
  constructor() {
    this.itens = [];
  }

  adicionar(item, quantidade = 1) {
    this.itens.push({ item, quantidade });
    return this;
  }

  get subtotal() {
    return somar(this.itens.map(({ item, quantidade }) => item.preco * quantidade));
  }

  total(descontoEmPorcento = 0) {
    return this.subtotal - porcentagem(this.subtotal, descontoEmPorcento);
  }

  linhas() {
    return this.itens.map(({ item, quantidade }) => `${quantidade}x ${item.nome} — ${moeda(item.preco * quantidade)}`);
  }
}
