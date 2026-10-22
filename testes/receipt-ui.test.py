"""UI tests for local receipt review; fake OCR bytes/text, no external services.
Run from this directory/repo with: python3 testes/receipt-ui.test.py
"""
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import shutil
import threading

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TODAY = datetime.now().strftime('%d/%m/%Y')
TODAY_ISO = datetime.now().strftime('%Y-%m-%d')
RAW_OCR = (
    f"Mercado Fictício\n{TODAY}\n"
    "Leite integral 2 UN X 5,50 11,00\n"
    "Arroz 1 KG X 8,90 8,90\n"
    "TOTAL R$ 19,90\n"
)
PNG_BYTES = bytes([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
contexts = []


def fixture(browser, width=390):
    context = browser.new_context(
        viewport={'width': width, 'height': 844},
        service_workers='block',
        accept_downloads=True,
    )
    contexts.append(context)
    external_requests, write_requests, errors, dialogs = [], [], [], []

    def route_request(route):
        target = urlparse(route.request.url)
        if target.hostname != '127.0.0.1':
            external_requests.append(route.request.url)
            route.abort()
        elif target.path == '/config.js':
            # Always exercise local-only mode, regardless of the checked-in config.
            route.fulfill(content_type='application/javascript', body='window.APP_CONFIG = {};')
        else:
            route.continue_()

    context.route('**/*', route_request)
    context.add_init_script("""(() => {
      localStorage.setItem('casa-organizada:v1', JSON.stringify({
        config: {pessoas: {id:'pessoas', nomes:['Pessoa fictícia','Outra pessoa'], filhos:[]}},
        lista: {
          mercado: {id:'mercado', nome:'Mercado fictício', icone:'🛒'},
          outra: {id:'outra', nome:'Outra lista'}
        },
        item: {
          leite: {id:'leite', lista:'mercado', texto:'Leite integral', feito:false},
          arroz: {id:'arroz', lista:'mercado', texto:'Arroz', feito:false},
          feito: {id:'feito', lista:'mercado', texto:'Feijão já comprado', feito:true},
          fora: {id:'fora', lista:'outra', texto:'Item de outra lista', feito:false}
        },
        conta: {conta_preservada: {id:'conta_preservada', nome:'Conta preservada', tipo:'unica', data:'2026-10-22', valor:42, revisado:true}},
        recado: {recado_preservado: {id:'recado_preservado', texto:'Recado preservado', curtidas:[], em:'2026-10-22T00:00:00Z'}}
      }));
    })();""")
    page = context.new_page()
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.on('request', lambda req: write_requests.append((req.method, req.url)) if req.method not in ('GET', 'HEAD', 'OPTIONS') else None)
    page.on('dialog', lambda dlg: (dialogs.append(dlg.message), dlg.accept()))
    page.goto(base + '/#/listas')
    expect(page.get_by_role('heading', name='Listas compartilhadas')).to_be_visible()
    page.locator('[data-action=pick-list][data-id=mercado]').click()
    page.evaluate("""(raw) => {
      window.__receiptResult = {text: raw, confidence: 98, pages: 1, warnings: []};
      window.__receiptMode = 'resolve';
      window.__receiptCalls = [];
      window.ReceiptOCR = {read: (file, options) => {
        window.__receiptCalls.push({name:file.name, type:file.type, size:file.size});
        window.__receiptSignal = options.signal;
        if (window.__receiptMode === 'reject') return Promise.reject(new Error('Falha OCR fictícia'));
        if (window.__receiptMode === 'hold') return new Promise((resolve, reject) => {
          window.__receiptResolve = () => resolve(window.__receiptResult);
          window.__receiptReject = reject;
          options.signal.addEventListener('abort', () => { window.__receiptAborted = true; }, {once:true});
        });
        return Promise.resolve(window.__receiptResult);
      }};
    }""", RAW_OCR)
    return page, external_requests, write_requests, errors, dialogs


def upload_receipt(page):
    page.locator('[data-action=purchase-ocr]').set_input_files({
        'name': 'nota-ficticia.png', 'mimeType': 'image/png', 'buffer': PNG_BYTES,
    })


try:
    with sync_playwright() as p:
        browser_path = shutil.which('chromium')
        assert browser_path, 'Chromium não está instalado.'
        browser = p.chromium.launch(executable_path=browser_path, args=['--no-sandbox'])

        # Revisão e cancelamento não alteram nenhum registro; correspondência só por nome exato.
        page, external, writes, errors, dialogs = fixture(browser)
        initial = page.evaluate('Store.exportAll()')
        upload_receipt(page)
        modal = page.locator('#modal')
        expect(modal.get_by_role('heading', name='Revisar nota antes de guardar')).to_be_visible()
        form = modal.locator('form')
        expect(form.locator('.receipt-item')).to_have_count(2)
        rows = form.locator('.receipt-item')
        assert rows.nth(0).locator('[data-field=texto]').input_value() == 'Leite integral'
        assert rows.nth(0).locator('[data-field=source]').input_value() == 'leite'
        assert rows.nth(1).locator('[data-field=source]').input_value() == 'arroz'
        assert page.evaluate('Store.exportAll()') == initial, 'Abrir revisão salvou dados antes da confirmação.'
        assert page.evaluate('window.__receiptCalls.length') == 1
        assert page.evaluate('window.__receiptCalls[0].type') == 'image/png'
        assert not writes, f'Leitura local disparou requisição de escrita: {writes}'
        assert all(urlparse(url).hostname == 'fonts.googleapis.com' for url in external), external

        # O checkbox é obrigatório; vínculos duplicados precisam ser bloqueados.
        form.get_by_role('button', name='Confirmar e guardar compra').click()
        expect(form.locator('[role=alert]')).to_contain_text('Marque que conferiu')
        rows.nth(1).locator('[data-field=source]').select_option('leite')
        form.locator('[name=revisado]').check()
        form.get_by_role('button', name='Confirmar e guardar compra').click()
        expect(form.locator('[role=alert]')).to_contain_text('vinculado a duas linhas')
        assert page.evaluate('Store.exportAll()') == initial

        # Ajustes editáveis, preço unitário, vínculo desmarcado e linha extra sem vínculo.
        rows.nth(1).locator('[data-field=source]').select_option('')
        rows.nth(0).locator('[data-field=quantidade]').fill('3')
        rows.nth(0).locator('[data-field=preco]').fill('5,25')
        rows.nth(1).locator('[data-field=texto]').fill('Arroz agulhinha')
        rows.nth(1).locator('[data-field=preco]').fill('9,10')
        form.locator('[name=loja]').fill('Mercado corrigido')
        form.locator('[name=total]').fill('25,00')
        form.locator('[data-receipt-add]').click()
        rows = form.locator('.receipt-item')
        expect(rows).to_have_count(3)
        assert rows.nth(2).locator('[data-field=source]').input_value() == ''
        rows.nth(2).locator('[data-field=texto]').fill('Café incluído na revisão')
        rows.nth(2).locator('[data-field=quantidade]').fill('1')
        rows.nth(2).locator('[data-field=unidade]').fill('pacote')
        rows.nth(2).locator('[data-field=preco]').fill('12,00')
        # Toda edição desmarca revisão; confirmar sem marcar continua bloqueado.
        form.get_by_role('button', name='Confirmar e guardar compra').click()
        expect(form.locator('[role=alert]')).to_contain_text('Marque que conferiu')
        form.locator('[name=revisado]').check()
        form.get_by_role('button', name='Cancelar', exact=True).click()
        expect(modal).not_to_be_visible()
        assert page.evaluate('Store.exportAll()') == initial, 'Cancelar revisão alterou os dados.'

        # Repetir e guardar: só o vínculo explícito (Leite) sai da lista; Arroz permanece.
        page.close()
        page, external, writes, errors, dialogs = fixture(browser)
        initial = page.evaluate('Store.exportAll()')
        modal = page.locator('#modal')
        upload_receipt(page)
        expect(modal.get_by_role('heading', name='Revisar nota antes de guardar')).to_be_visible()
        form = modal.locator('form')
        rows = form.locator('.receipt-item')
        rows.nth(1).locator('[data-field=source]').select_option('')
        rows.nth(0).locator('[data-field=quantidade]').fill('3')
        rows.nth(0).locator('[data-field=preco]').fill('5,25')
        rows.nth(1).locator('[data-field=texto]').fill('Arroz agulhinha')
        rows.nth(1).locator('[data-field=preco]').fill('9,10')
        form.locator('[name=loja]').fill('Mercado corrigido')
        form.locator('[name=total]').fill('25,00')
        form.locator('[data-receipt-add]').click()
        rows = form.locator('.receipt-item')
        rows.nth(2).locator('[data-field=texto]').fill('Café incluído na revisão')
        rows.nth(2).locator('[data-field=quantidade]').fill('1')
        rows.nth(2).locator('[data-field=unidade]').fill('pacote')
        rows.nth(2).locator('[data-field=preco]').fill('12,00')
        form.locator('[name=revisado]').check()
        form.get_by_role('button', name='Confirmar e guardar compra').click()
        expect(modal).not_to_be_visible()

        saved = page.evaluate('Store.exportAll()')
        purchases = list(saved.get('compra', {}).values())
        assert len(purchases) == 1, f'Esperada uma compra, obtido {len(purchases)}.'
        purchase = purchases[0]
        assert purchase['origem'] == 'nota-revisada'
        assert purchase['lista'] == 'mercado' and purchase['loja'] == 'Mercado corrigido'
        assert purchase['total'] == 25
        by_name = {item['texto']: item for item in purchase['itens']}
        assert by_name['Leite integral']['itemId'] == 'leite'
        assert by_name['Leite integral']['quantidade'] == 3 and by_name['Leite integral']['preco'] == 5.25
        assert by_name['Arroz agulhinha']['itemId'].startswith('nota-')
        assert by_name['Arroz agulhinha']['preco'] == 9.1
        assert by_name['Café incluído na revisão']['itemId'].startswith('nota-')
        assert by_name['Café incluído na revisão']['unidade'] == 'pacote'
        assert 'leite' not in saved['item']
        assert saved['item']['arroz']['feito'] is False
        assert saved['item']['feito'] == initial['item']['feito']
        assert saved['item']['fora'] == initial['item']['fora']
        assert saved['conta'] == initial['conta'] and saved['recado'] == initial['recado']
        assert not saved.get('tarefa')
        assert all('nota' not in c for c in purchases), 'Arquivo original não deve ser armazenado em modo local.'
        assert not writes, f'Algum fluxo local fez requisição de escrita: {writes}'
        assert all(urlparse(url).hostname == 'fonts.googleapis.com' for url in external), external

        # Exportação JSON não leva o texto OCR bruto nem bytes/imagem da nota.
        with page.expect_download() as info:
            page.get_by_role('button', name='Exportar JSON', exact=True).click()
        export_json = json.loads(Path(info.value.path()).read_text())
        export_text = json.dumps(export_json, ensure_ascii=False)
        assert len(export_json['compras']) == 1
        assert RAW_OCR not in export_text
        assert 'nota-ficticia.png' not in export_text and 'iVBOR' not in export_text
        assert 'receipt-raw' not in export_text
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Overflow em 390px.'
        page.set_viewport_size({'width': 320, 'height': 750})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Overflow horizontal em 320px.'
        assert errors == [], errors
        browser.close()

        # Em modo nuvem simulado, falha do anexo não desfaz nem duplica o ledger.
        cloud_browser = p.chromium.launch(executable_path=browser_path, args=['--no-sandbox'])
        page, external, writes, errors, dialogs = fixture(cloud_browser)
        page.evaluate("""() => {
          Store.mode = () => 'cloud';
          Store.attachPurchaseReceipt = async () => { throw new Error('Falha fictícia no anexo'); };
        }""")
        upload_receipt(page)
        modal = page.locator('#modal')
        expect(modal.get_by_role('heading', name='Revisar nota antes de guardar')).to_be_visible()
        form = modal.locator('form')
        form.locator('[name=revisado]').check()
        form.get_by_role('button', name='Confirmar e guardar compra').click()
        expect(modal).not_to_be_visible()
        assert any('Compra guardada' in message and 'Falha fictícia no anexo' in message for message in dialogs), dialogs
        cloud_saved = page.evaluate('Store.exportAll()')
        assert len(cloud_saved.get('compra', {})) == 1, 'Compra deve persistir mesmo se anexar nota falhar.'
        assert not list(cloud_saved['compra'].values())[0].get('nota')
        assert errors == [], errors
        cloud_browser.close()

        # Falha de leitura e cancelamento durante leitura não persistem nada.
        browser2 = p.chromium.launch(executable_path=browser_path, args=['--no-sandbox'])
        page, external, writes, errors, dialogs = fixture(browser2)
        before = page.evaluate('Store.exportAll()')
        page.evaluate("window.__receiptMode = 'reject'")
        upload_receipt(page)
        modal = page.locator('#modal')
        expect(modal.get_by_role('heading', name='Não foi possível ler a nota')).to_be_visible()
        expect(modal.locator('.receipt-error-detail')).to_contain_text('Falha OCR fictícia')
        assert page.evaluate('Store.exportAll()') == before
        modal.locator('[data-receipt-close]').first.click()
        expect(modal).not_to_be_visible()

        page.close()
        page, external, writes, errors, dialogs = fixture(browser2)
        before = page.evaluate('Store.exportAll()')
        modal = page.locator('#modal')
        page.evaluate("window.__receiptMode = 'hold'")
        upload_receipt(page)
        expect(modal.get_by_text('Preparando leitura…')).to_be_visible()
        assert page.evaluate('window.__receiptCalls.length') == 1
        modal.locator('[data-receipt-close]').first.click()
        expect(modal).not_to_be_visible()
        expect(page.locator('body')).to_be_visible()
        page.wait_for_function('window.__receiptAborted === true')
        page.evaluate('window.__receiptResolve()')
        page.wait_for_timeout(50)
        assert page.evaluate('Store.exportAll()') == before, 'Resultado tardio após cancelar foi salvo.'
        assert not writes
        assert all(urlparse(url).hostname == 'fonts.googleapis.com' for url in external), external
        assert errors == [], errors
        browser2.close()

        for context in contexts:
            try:
                context.close()
            except Exception:
                pass
        print('OK receipt UI: revisão explícita, vínculos, ledger local, exportação, falhas/cancelamento e viewport 320px')
finally:
    server.shutdown()
