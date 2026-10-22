// Veículos são registros compartilhados da casa, não tarefas: não participam do push.
// Arquivos pequenos ficam no próprio registro, sob a mesma RLS e no backup existente.
const Veiculos = (() => {
  const TIPOS = { manutencao: 'Manutenção', anual: 'Manutenção anual', obd: 'Diagnóstico OBD', multa: 'Multa de trânsito' };
  const MAX_ARQUIVO = 1024 * 1024;
  const MAX_TOTAL = 2 * MAX_ARQUIVO;
  const MAX_ANEXOS = 3;
  const MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  const temTipo = tipo => Object.prototype.hasOwnProperty.call(TIPOS, tipo);
  function dataValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s) || s.slice(0, 4) === '0000') return false;
    const d = new Date(s + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  function validarVeiculo(v) {
    if (typeof v?.nome !== 'string' || !v.nome.trim()) return 'Informe um nome para identificar o veículo.';
    return '';
  }
  function validarRegistro(r, veiculos) {
    if (!r || typeof r.titulo !== 'string' || !r.titulo.trim()) return 'Informe o título do registro.';
    if (!veiculos.some(v => v.id === r.veiculo)) return 'Escolha um veículo cadastrado.';
    if (!temTipo(r.tipo)) return 'Tipo de registro inválido.';
    if (!['pendente', 'resolvido'].includes(r.status)) return 'Status inválido.';
    if (!dataValida(r.data)) return 'Informe uma data de registro válida.';
    for (const [campo, nome] of [['prazo', 'Prazo/vencimento'], ['realizadaEm', 'Data de realização'], ['ocorrenciaEm', 'Data da infração'], ['prazoDefesa', 'Prazo de defesa'], ['prazoRecurso', 'Prazo de recurso']]) {
      if (r[campo] && !dataValida(r[campo])) return `${nome}: data inválida ou inexistente.`;
    }
    if (r.km !== '' && r.km != null && (!Number.isInteger(r.km) || r.km < 0)) return 'Quilometragem deve ser um inteiro maior ou igual a zero.';
    if (r.valor !== '' && r.valor != null && (typeof r.valor !== 'number' || !Number.isFinite(r.valor) || r.valor < 0)) return 'Valor deve ser um número maior ou igual a zero.';
    return '';
  }
  function prazos(r) {
    const pares = r.tipo === 'multa'
      ? [['prazo', 'Pagamento'], ['prazoDefesa', 'Defesa'], ['prazoRecurso', 'Recurso']]
      : [['prazo', 'Próxima manutenção / prazo']];
    return pares.filter(([k]) => dataValida(r[k])).map(([k, label]) => ({ campo: k, label, data: r[k] })).sort((a, b) => a.data.localeCompare(b.data));
  }
  const proximoPrazo = r => r.status === 'resolvido' ? '' : (prazos(r)[0]?.data || '');
  const ordenar = registros => [...registros].sort((a, b) => (a.status === 'resolvido') - (b.status === 'resolvido') ||
    (proximoPrazo(a) || '9999').localeCompare(proximoPrazo(b) || '9999') || (b.data || '').localeCompare(a.data || ''));
  function validarSelecao(existentes, files) {
    if (existentes.length + files.length > MAX_ANEXOS) return `Use no máximo ${MAX_ANEXOS} anexos por registro.`;
    if (files.some(f => !MIMES.includes(f.type) || f.size <= 0 || f.size > MAX_ARQUIVO)) return 'Anexe PDF, PNG, JPEG ou WebP de até 1 MB cada (não vazio).';
    if ([...existentes, ...files].reduce((n, f) => n + (f.size || 0), 0) > MAX_TOTAL) return 'Os anexos deste registro devem somar no máximo 2 MB.';
    return '';
  }
  function assinatura(bytes, tipo) {
    const texto = String.fromCharCode(...bytes.slice(0, 12));
    return tipo === 'application/pdf' ? texto.startsWith('%PDF-')
      : tipo === 'image/png' ? bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
      : tipo === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : tipo === 'image/webp' && texto.startsWith('RIFF') && texto.slice(8, 12) === 'WEBP';
  }
  function bytesAnexo(a) {
    if (!a || typeof a.nome !== 'string' || !MIMES.includes(a.type) || !Number.isInteger(a.size) || a.size <= 0 || a.size > MAX_ARQUIVO || typeof a.dados !== 'string') throw new Error('Anexo inválido.');
    const prefixo = `data:${a.type};base64,`;
    if (!a.dados.startsWith(prefixo)) throw new Error('Formato do anexo inválido.');
    const base64 = a.dados.slice(prefixo.length);
    if (base64.length !== 4 * Math.ceil(a.size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Conteúdo do anexo inválido.');
    const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
    if (bytes.length !== a.size || !assinatura(bytes, a.type)) throw new Error('Arquivo não corresponde ao tipo informado.');
    return bytes;
  }
  function validarAnexos(anexos) {
    if (!Array.isArray(anexos)) return 'Lista de anexos inválida.';
    const erro = validarSelecao(anexos, []);
    if (erro) return erro;
    try { anexos.forEach(bytesAnexo); } catch (e) { return e.message; }
    return '';
  }
  async function lerAnexos(existentes, files) {
    const erro = validarAnexos(existentes) || validarSelecao(existentes, files);
    if (erro) throw new Error(erro);
    const novos = [];
    for (const file of files) {
      const dados = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo. Tente anexá-lo novamente.'));
        reader.readAsDataURL(file);
      });
      const anexo = { id: U.uid(), nome: file.name, type: file.type, size: file.size, dados };
      bytesAnexo(anexo);
      novos.push(anexo);
    }
    return [...existentes, ...novos];
  }
  function baixar(anexo) {
    const url = URL.createObjectURL(new Blob([bytesAnexo(anexo)], { type: anexo.type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = anexo.nome.replace(/[\\/\x00-\x1f]/g, '_');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  return { TIPOS, MAX_ARQUIVO, MAX_TOTAL, MAX_ANEXOS, dataValida, validarVeiculo, validarRegistro,
    prazos, proximoPrazo, ordenar, validarSelecao, validarAnexos, lerAnexos, bytesAnexo, baixar };
})();
