"""Teste local da seção Impostos e taxas pessoais, sem acesso à produção.
Rodar: python3 testes/impostos-ui.test.py
Requer playwright (Python) e Chromium local ou `playwright install chromium`.
O servidor aceita apenas localhost, config.js é vazio e service workers são bloqueados.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
errors = []
blocked = []
dialogs = []

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')

        def route_request(route):
            target = route.request.url
            if urlparse(target).hostname != '127.0.0.1':
                blocked.append(target)
                route.abort()
            elif urlparse(target).path == '/config.js':
                route.fulfill(content_type='application/javascript', body='window.APP_CONFIG = {};')
            else:
                route.continue_()

        context.route('**/*', route_request)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        def handle_dialog(dialog):
            if dialog.type == 'alert':
                dialogs.append(dialog.message)
            dialog.accept()
        page.add_init_script("""(() => {
          if (localStorage.getItem('impostos-ui-seeded')) return;
          const hoje = new Date();
          const dia = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
          const mes = dia.slice(0, 7);
          const ano = hoje.getFullYear();
          const conta = (id, nome, extra={}) => ({
            id, nome, valor: 100, tipo: 'unica', data: dia, responsavel: 'Renato',
            categoria: 'Impostos', pagos: {}, ...extra
          });
          const contas = {
            'legado-mensal': conta('legado-mensal', 'Luz mensal fictícia', {
              valor: 180, tipo: 'mensal', dia: 10, categoria: 'Água / Luz / Gás', responsavel: 'Vanessa'
            }),
            'legado-comum': conta('legado-comum', 'Conta comum fictícia', {
              categoria: 'Moradia', responsavel: 'Renato'
            }),
            'legado-impostos': conta('legado-impostos', 'Imposto antigo sem obrigação', {
              categoria: 'Impostos', responsavel: 'Renato', legadoExtra: 'preservar-me'
            }),
            'iptu-atual': conta('iptu-atual', 'IPTU referência atual', {
              obrigacao: 'iptu', anoReferencia: ano, modalidade: 'unica',
              referencia: 'Casa fictícia', responsavel: 'Renato', categoria: 'Impostos'
            }),
            'ipva-ambos': conta('ipva-ambos', 'IPVA de Ambos', {
              obrigacao: 'ipva', anoReferencia: ano, modalidade: 'parcela', parcela: 1, parcelas: 3,
              responsavel: 'Ambos', categoria: 'Impostos'
            }),
            'ref-passada-data-atual': conta('ref-passada-data-atual', 'IRPF referência passada', {
              obrigacao: 'irpf', anoReferencia: ano - 1, modalidade: 'unica',
              responsavel: 'Vanessa', categoria: 'Impostos'
            }),
            'imposto-pago': conta('imposto-pago', 'Licenciamento já pago', {
              obrigacao: 'licenciamento', anoReferencia: ano, modalidade: 'unica',
              responsavel: 'Vanessa', categoria: 'Impostos', legadoExtra: 'campo antigo',
              pagos: {[mes]: {data: dia, valor: 95}}
            })
          };
          localStorage.setItem('casa-organizada:v1', JSON.stringify({
            config: {pessoas:{id:'pessoas',nomes:['Renato','Vanessa','Antônio'],filhos:['Antônio']}},
            conta: contas
          }));
          localStorage.setItem('casa:eu', 'Renato');
          localStorage.setItem('impostos-ui-seeded', '1');
        })();""")
        page.on('dialog', handle_dialog)
        page.goto(url + '/#/contas')
        expect(page.get_by_role('heading', name='Contas e pagamentos', exact=True)).to_be_visible()
        section = lambda: page.locator('section.panel').filter(
            has=page.get_by_role('heading', name='Impostos e taxas pessoais', exact=True))
        expect(section()).to_be_visible()
        panel = section()
        add = lambda: panel.get_by_role('button', name='+ Imposto ou taxa pessoal', exact=True)
        row = lambda name: panel.locator('.tax-entry').filter(has=page.locator('strong', has_text=name))
        storage = lambda: page.evaluate("JSON.parse(localStorage.getItem('casa-organizada:v1'))")
        initial = storage()
        assert len(initial['conta']) == 7
        # Leitura e filtros não gravam nem reclassificam contas existentes.
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_be_visible()
        expect(panel.get_by_text('IPVA de Ambos', exact=False)).to_be_visible()
        expect(panel.get_by_text('Imposto antigo sem obrigação', exact=False)).to_have_count(0)
        assert 'obrigacao' not in storage()['conta']['legado-impostos']
        panel.get_by_label('Responsável pelo imposto').select_option('Vanessa')
        expect(panel.get_by_text('IPVA de Ambos', exact=False)).to_be_visible()  # ehDe(Ambos)
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_have_count(0)
        panel.get_by_label('Responsável pelo imposto').select_option('')
        panel.get_by_label('Tipo de obrigação').select_option('iptu')
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_be_visible()
        expect(panel.get_by_text('IPVA de Ambos', exact=False)).to_have_count(0)
        panel.get_by_label('Tipo de obrigação').select_option('')
        panel.get_by_label('Ano de referência').select_option(str(__import__('datetime').date.today().year - 1))
        expect(panel.get_by_text('IRPF referência passada', exact=False)).to_be_visible()
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_have_count(0)
        panel.get_by_label('Ano de referência').select_option(str(__import__('datetime').date.today().year))
        panel.get_by_label('Status do imposto').select_option('pago')
        expect(panel.get_by_text('Licenciamento já pago', exact=False)).to_be_visible()
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_have_count(0)
        panel.get_by_label('Status do imposto').select_option('aberta')
        expect(panel.get_by_text('IPTU referência atual', exact=False)).to_be_visible()
        panel.get_by_label('Status do imposto').select_option('')
        assert storage() == initial

        # Cancelar cadastro não grava nada.
        add().click()
        form = page.locator('#modal form')
        form.locator('[name="nome"]').fill('Cancelamento sem persistência')
        form.get_by_role('button', name='Cancelar', exact=True).click()
        assert storage() == initial

        # Criar cota única com referência hostil escapada e URLs HTTPS; nenhuma repetição automática.
        add().click()
        form = page.locator('#modal form')
        form.locator('[name="nome"]').fill('Cota manual segura')
        form.locator('[name="obrigacao"]').select_option('iptu')
        form.locator('[name="anoReferencia"]').fill(str(__import__('datetime').date.today().year))
        form.locator('[name="referencia"]').fill('<img src=x onerror=alert(1)>')
        form.locator('[name="modalidade"]').select_option('unica')
        form.locator('[name="valor"]').fill('125,50')
        form.locator('[name="data"]').fill(__import__('datetime').date.today().isoformat())
        form.locator('[name="responsavel"]').select_option('Renato')
        form.locator('[name="guiaUrl"]').fill('https://example.test/guia')
        form.locator('[name="comprovanteUrl"]').fill('https://example.test/comprovante')
        form.get_by_role('button', name='Salvar', exact=True).click()
        expect(panel.get_by_text('Cota manual segura', exact=False)).to_be_visible()
        assert panel.locator('img').count() == 0
        created = next(c for c in storage()['conta'].values() if c.get('nome') == 'Cota manual segura')
        created_id = created['id']
        assert created['categoria'] == 'Impostos' and created['tipo'] == 'unica'
        assert created['modalidade'] == 'unica' and created.get('parcela', '') in ('', None)
        assert created.get('pagos', {}) == {}
        assert created['referencia'] == '<img src=x onerror=alert(1)>'
        assert row('Cota manual segura').get_by_role('link', name='Abrir guia').get_attribute('rel') == 'noopener noreferrer'
        assert row('Cota manual segura').get_by_role('link', name='Abrir comprovante').get_attribute('rel') == 'noopener noreferrer'
        for link in row('Cota manual segura').get_by_role('link').all():
            assert link.get_attribute('href').startswith('https://')

        # Formulário recusa valor inválido e URL javascript sem persistir.
        add().click()
        form = page.locator('#modal form')
        form.locator('[name="nome"]').fill('Imposto inválido')
        form.locator('[name="obrigacao"]').select_option('ipva')
        form.locator('[name="anoReferencia"]').fill(str(__import__('datetime').date.today().year))
        form.locator('[name="modalidade"]').select_option('parcela')
        form.locator('[name="parcela"]').fill('5')
        form.locator('[name="parcelas"]').fill('2')
        form.locator('[name="valor"]').fill('0')
        form.locator('[name="data"]').fill(__import__('datetime').date.today().isoformat())
        form.locator('[name="responsavel"]').select_option('Renato')
        form.locator('[name="guiaUrl"]').fill('javascript:alert(1)')
        form.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal form')).to_be_visible()
        assert dialogs and ('Valor' in dialogs[-1] or 'parcela' in dialogs[-1].lower())
        form.locator('[name="parcela"]').fill('2')
        form.locator('[name="valor"]').fill('25,00')
        form.get_by_role('button', name='Salvar', exact=True).click()
        assert 'HTTPS' in dialogs[-1]
        assert not any(c.get('nome') == 'Imposto inválido' for c in storage()['conta'].values())
        form.get_by_role('button', name='Cancelar', exact=True).click()

        # Uma parcela manual é exatamente um registro: não cria cotas adicionais nem no ano seguinte.
        add().click()
        form = page.locator('#modal form')
        form.locator('[name="nome"]').fill('Parcela manual 2 de 4')
        form.locator('[name="obrigacao"]').select_option('ipva')
        form.locator('[name="anoReferencia"]').fill(str(__import__('datetime').date.today().year))
        form.locator('[name="modalidade"]').select_option('parcela')
        form.locator('[name="parcela"]').fill('2')
        form.locator('[name="parcelas"]').fill('4')
        form.locator('[name="valor"]').fill('89,90')
        form.locator('[name="data"]').fill(__import__('datetime').date.today().isoformat())
        form.locator('[name="responsavel"]').select_option('Vanessa')
        form.get_by_role('button', name='Salvar', exact=True).click()
        parcel = next(c for c in storage()['conta'].values() if c.get('nome') == 'Parcela manual 2 de 4')
        assert parcel['modalidade'] == 'parcela' and parcel['parcela'] == 2 and parcel['parcelas'] == 4
        count_after_manual = len(storage()['conta'])
        next_year = __import__('datetime').date.today().year + 1
        assert not any(c.get('anoReferencia') == next_year for c in storage()['conta'].values())
        assert len(storage()['conta']) == count_after_manual

        # Pagar, recarregar e desfazer mantém o estado persistido.
        cota = row('Cota manual segura')
        cota.get_by_role('button', name='Pagar', exact=True).click()
        pay_form = page.locator('#modal form')
        pay_form.get_by_role('button', name='Marcar como paga', exact=True).click()
        expect(row('Cota manual segura').get_by_role('button', name='Desfazer', exact=True)).to_be_visible()
        page.reload()
        panel = section()
        expect(row('Cota manual segura').get_by_role('button', name='Desfazer', exact=True)).to_be_visible()
        panel.get_by_label('Status do imposto').select_option('pago')
        expect(panel.get_by_text('Cota manual segura', exact=False)).to_be_visible()
        panel.get_by_label('Status do imposto').select_option('')
        row('Cota manual segura').get_by_role('button', name='Desfazer', exact=True).click()
        expect(row('Cota manual segura').get_by_role('button', name='Pagar', exact=True)).to_be_visible()
        page.reload()
        panel = section()
        expect(row('Cota manual segura').get_by_role('button', name='Pagar', exact=True)).to_be_visible()

        # Editar preserva pagamentos e campos legados; contas comuns e antigas seguem intactas.
        paid = row('Licenciamento já pago')
        paid.get_by_role('button', name='Editar', exact=True).click()
        edit_form = page.locator('#modal form')
        expect(edit_form.locator('[name="anoReferencia"]')).to_have_value(str(__import__('datetime').date.today().year))
        edit_form.locator('[name="nome"]').fill('Licenciamento já pago editado')
        edit_form.get_by_role('button', name='Salvar', exact=True).click()
        saved = storage()['conta']['imposto-pago']
        assert saved['pagos'] and saved['legadoExtra'] == 'campo antigo'
        assert storage()['conta']['legado-impostos']['legadoExtra'] == 'preservar-me'
        assert storage()['conta']['legado-mensal']['tipo'] == 'mensal'
        assert 'obrigacao' not in storage()['conta']['legado-impostos']

        # Sem overflow nas larguras pedidas.
        for width, height in [(320, 740), (390, 844), (1280, 900)]:
            page.set_viewport_size({'width': width, 'height': height})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow em {width}px'
        assert not errors, errors
        assert not any('supabase' in target for target in blocked), blocked
        browser.close()
        print('ok - navegação/leitura, filtros ano/tipo/responsável/Ambos/status, cancelamento, validação, criação manual sem repetição, escape/HTTPS, pagar/desfazer/reload, edição e legado; 320/390/1280px; sem produção')
finally:
    server.shutdown()
    server.server_close()
