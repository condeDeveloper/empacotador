/**
 * empacotador — módulos ES num arquivo só.
 */

export { empacotar, empacotarPara, recuar, TEMPO_DE_EXECUCAO } from './empacotador.js';
export { montarGrafo, ordenar, acharCiclos, resumo, ErroDeGrafo } from './grafo.js';
export { analisar, lerClausula, lerEspecificadores, ErroDeAnalise } from './analise.js';
export { sombra, posicaoLegivel, ErroDeVarredura } from './varredura.js';
export { resolver, tentar, ehRelativo, identidade, EXTENSOES, ErroDeResolucao } from './resolucao.js';
export { transformar, substituir, PADRAO } from './transformacao.js';
