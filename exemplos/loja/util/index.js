// Funções puras, sem dependência nenhuma: entram primeiro na ordem.
export const somar = (numeros) => numeros.reduce((total, n) => total + n, 0);

export function porcentagem(valor, taxa) {
  return valor * (taxa / 100);
}
