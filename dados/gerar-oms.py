# Gera dados/oms-crescimento.json a partir das tabelas oficiais da OMS (WHO Child Growth Standards, 2006).
# Tabelas "expanded" (dia a dia, 0 a 1856 dias) com os parâmetros L, M e S de cada idade.
# Uso: baixe os 6 arquivos .xlsx abaixo para uma pasta e rode: python3 gerar-oms.py <pasta>  (precisa de openpyxl)
import json, sys, os
import openpyxl

BASE = 'https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/'
ARQUIVOS = {
    'peso': 'weight-for-age/expanded-tables/wfa-{sx}-zscore-expanded-tables.xlsx',
    'comprimento': 'length-height-for-age/expandable-tables/lhfa-{sx}-zscore-expanded-tables.xlsx',
    'pc': 'head-circumference-for-age/expanded-tables/hcfa-{sx}-zscore-expanded-tables.xlsx',
}
SEXOS = {'M': 'boys', 'F': 'girls'}

pasta = sys.argv[1]
out = {
    'fonte': 'WHO Child Growth Standards (2006), tabelas expandidas de escore-z (L, M, S por dia de vida)',
    'url': 'https://www.who.int/tools/child-growth-standards/standards',
    'arquivos': {k: BASE + v for k, v in ARQUIVOS.items()},
    'tabelas': {},
}
for ind, arq in ARQUIVOS.items():
    for sx, nome in SEXOS.items():
        ws = openpyxl.load_workbook(os.path.join(pasta, os.path.basename(arq.format(sx=nome))), read_only=True).active
        rows = list(ws.iter_rows(values_only=True))
        assert rows[0][:4] == ('Day', 'L', 'M', 'S'), rows[0]
        dados = rows[1:]
        assert [r[0] for r in dados] == list(range(len(dados))), 'dias fora de ordem'
        L = [r[1] for r in dados]
        out['tabelas'][f'{ind}-{sx}'] = {
            'L': L[0] if len(set(L)) == 1 else L,  # comprimento e PC têm L = 1 em todos os dias
            'M': [r[2] for r in dados],
            'S': [r[3] for r in dados],
            # Linhas de escore-z da própria OMS, para conferir o cálculo nos testes (a cada 30 dias).
            'conferencia': {str(r[0]): [r[5], r[6], r[8], r[10], r[11]] for r in dados if r[0] % 30 == 0},
        }
with open(os.path.join(os.path.dirname(__file__), 'oms-crescimento.json'), 'w') as f:
    json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
print('ok', {k: len(v['M']) for k, v in out['tabelas'].items()})
