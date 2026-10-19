// Curvas de crescimento da OMS (WHO Child Growth Standards, 2006): escore-z, percentil e classificação.
// Os dados (L, M e S por dia de vida, 0 a 1856 dias) ficam em dados/oms-crescimento.json e só são
// baixados quando a página dos filhos abre. Classificação: Caderneta da Criança, 7ª ed., MS 2024, p. 92 a 95.
const Crescimento = (() => {
  let dados = null;
  let carregando = null;
  const pronto = () => !!dados;
  // No navegador busca o JSON; nos testes, `usar` recebe o objeto já lido do disco.
  const usar = d => { dados = d; };
  function carregar() {
    if (dados) return Promise.resolve(dados);
    if (!carregando) {
      carregando = fetch('dados/oms-crescimento.json').then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(d => { dados = d; return d; }).catch(e => { carregando = null; throw e; });
    }
    return carregando;
  }

  const INDICADORES = {
    peso: { nome: 'Peso para idade', unidade: 'kg', casas: 3 },
    comprimento: { nome: 'Comprimento/altura para idade', unidade: 'cm', casas: 1 },
    pc: { nome: 'Perímetro cefálico para idade', unidade: 'cm', casas: 1 },
  };
  const DIAS_MAX = 1856; // 5 anos
  const tabela = (ind, sexo) => dados?.tabelas?.[`${ind}-${sexo}`] || null;
  function lms(ind, sexo, dias) {
    const t = tabela(ind, sexo);
    const d = Math.round(dias);
    if (!t || d < 0 || d > DIAS_MAX) return null;
    return { L: Array.isArray(t.L) ? t.L[d] : t.L, M: t.M[d], S: t.S[d] };
  }
  // Valor da medida para um escore-z (para desenhar as curvas).
  const valorZ = ({ L, M, S }, z) => (L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L));

  // Escore-z pelo método LMS. Para peso, a OMS corrige os valores além de ±3 usando a distância
  // entre as linhas +2/+3 (ou −2/−3), conforme "Computation of centiles and z-scores" (WHO, 2006).
  function zscore(ind, sexo, dias, x) {
    const p = lms(ind, sexo, dias);
    if (!p || !(x > 0)) return null;
    const { L, M, S } = p;
    let z = L === 0 ? Math.log(x / M) / S : (Math.pow(x / M, L) - 1) / (L * S);
    if (ind === 'peso' && Math.abs(z) > 3) {
      const sd3 = valorZ(p, Math.sign(z) * 3), sd2 = valorZ(p, Math.sign(z) * 2);
      z = Math.sign(z) * 3 + (x - sd3) / Math.abs(sd3 - sd2);
    }
    return Math.round(z * 100) / 100;
  }

  // Percentil a partir do escore-z (distribuição normal; aproximação de Abramowitz e Stegun 7.1.26).
  function percentil(z) {
    if (z == null) return null;
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    const p = 0.5 * (1 + Math.sign(z) * erf) * 100;
    return p < 0.1 ? 0.1 : p > 99.9 ? 99.9 : Math.round(p * 10) / 10;
  }

  // Classificação da Caderneta da Criança (p. 92 a 95). tom: ok | atencao | alerta
  function classificar(ind, z) {
    if (z == null) return null;
    if (ind === 'peso') {
      if (z < -3) return { texto: 'Muito baixo peso para a idade', tom: 'alerta' };
      if (z < -2) return { texto: 'Baixo peso para a idade', tom: 'atencao' };
      if (z > 2) return { texto: 'Peso elevado para a idade', tom: 'atencao' };
      return { texto: 'Peso adequado para a idade', tom: 'ok' };
    }
    if (ind === 'comprimento') {
      if (z < -3) return { texto: 'Muito baixo comprimento para a idade', tom: 'alerta' };
      if (z < -2) return { texto: 'Baixo comprimento para a idade', tom: 'atencao' };
      return { texto: 'Comprimento adequado para a idade', tom: 'ok' };
    }
    if (z < -2) return { texto: 'PC abaixo do esperado para a idade', tom: 'atencao' };
    if (z > 2) return { texto: 'PC acima do esperado para a idade', tom: 'atencao' };
    return { texto: 'PC adequado para a idade', tom: 'ok' };
  }

  // Pontos de uma linha de escore-z, de 0 até `ate` dias (um ponto a cada `passo` dias).
  function curva(ind, sexo, z, ate, passo = 7) {
    const out = [];
    for (let d = 0; d <= Math.min(ate, DIAS_MAX); d += passo) out.push([d, valorZ(lms(ind, sexo, d), z)]);
    const fim = Math.min(ate, DIAS_MAX);
    if (out[out.length - 1][0] !== fim) out.push([fim, valorZ(lms(ind, sexo, fim), z)]);
    return out;
  }

  const fonte = () => dados?.fonte || 'WHO Child Growth Standards (2006)';
  return { INDICADORES, DIAS_MAX, carregar, usar, pronto, lms, valorZ, zscore, percentil, classificar, curva, fonte };
})();
