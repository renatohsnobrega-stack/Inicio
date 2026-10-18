// Funções utilitárias de data, formatação e texto.
const U = (() => {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = s => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, m - 1, d || 1);
  };
  const addDays = (d, n) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  };
  const addMonths = (month, n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  // m é 1-based
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  // Segunda = 0 ... Domingo = 6
  const mondayIndex = d => (d.getDay() + 6) % 7;
  const startOfWeek = d => addDays(d, -mondayIndex(d));
  const today = () => ymd(new Date());
  const thisMonth = () => today().slice(0, 7);

  const WD = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
  const WDS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const monthLabel = month => {
    const [y, m] = month.split('-').map(Number);
    return `${MONTHS[m - 1]} de ${y}`;
  };
  const fmtDate = s => (s ? parseYmd(s).toLocaleDateString('pt-BR') : '');
  const fmtDay = s => { const d = parseYmd(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const longDate = s => parseYmd(s).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');

  const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Aceita "1.234,56", "150,9", "150.90", "R$ 80"
  const parseMoney = s => {
    if (typeof s === 'number') return s;
    s = String(s || '').trim().replace(/[R$\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  };

  // "8h, 12:30 20" -> ["08:00", "12:30", "20:00"]
  const parseTimes = s => {
    const raw = Array.isArray(s) ? s : String(s || '').split(/[,;\s]+/);
    const out = raw.map(t => String(t).trim()).filter(Boolean).map(t => {
      const m = t.match(/^(\d{1,2})(?:[:h](\d{2})?)?$/i);
      if (!m) return null;
      const h = +m[1], mi = +(m[2] || 0);
      return h > 23 || mi > 59 ? null : `${pad(h)}:${pad(mi)}`;
    }).filter(Boolean);
    return [...new Set(out)].sort();
  };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2));

  const groupBy = (arr, fn) => arr.reduce((acc, x) => {
    const k = fn(x);
    (acc[k] = acc[k] || []).push(x);
    return acc;
  }, {});

  return {
    pad, ymd, parseYmd, addDays, addMonths, daysInMonth, mondayIndex, startOfWeek, today, thisMonth,
    WD, WDS, MONTHS, monthLabel, fmtDate, fmtDay, longDate, esc, nl2br, brl, parseMoney, parseTimes,
    uid, groupBy,
  };
})();
