const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const moeda = (centavos) => REAIS.format(centavos / 100);

// A palavra `import` aqui dentro não pode virar dependência.
export const AVISO = 'use import em vez de require';
