"""OCR real + parser + revisão + histórico local. Somente nota e dados fictícios."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import shutil
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *_args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
external = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width':390,'height':844}, service_workers='block')
        def guard(route):
            target=urlparse(route.request.url)
            if target.hostname != '127.0.0.1':
                external.append(route.request.url)
                route.abort()
            elif target.path=='/config.js':
                route.fulfill(content_type='application/javascript', body='window.APP_CONFIG = {};')
            else: route.continue_()
        context.route('**/*',guard)
        page=context.new_page()
        page.on('pageerror',lambda err: errors.append(str(err)))
        page.add_init_script("""localStorage.setItem('casa-organizada:v1',JSON.stringify({
          lista:{teste:{id:'teste',nome:'TESTE FICTÍCIO OCR'}},
          item:{leite:{id:'leite',lista:'teste',texto:'LEITE FICTICIO',feito:false},
                pendente:{id:'pendente',lista:'teste',texto:'PRESERVAR PENDENTE FICTICIO',feito:false}}
        }));""")
        page.goto(f'http://127.0.0.1:{server.server_port}/#/listas')
        expect(page.locator('[data-action=purchase-ocr]')).to_be_attached()
        initial=page.evaluate('Store.exportAll()')
        page.locator('[data-action=purchase-ocr]').set_input_files(str(ROOT/'testes/ocr/fixtures/nota-completa-ficticia.png'))
        expect(page.get_by_role('heading',name='Revisar nota antes de guardar',exact=True)).to_be_visible(timeout=150000)
        assert page.evaluate('Store.exportAll()')==initial
        modal=page.locator('#modal')
        expect(modal.locator('[name=loja]')).to_have_value('MERCADO FICTICIO')
        expect(modal.locator('[name=data]')).to_have_value('2026-10-22')
        expect(modal.locator('[name=total]')).to_have_value('19,9')
        expect(modal.locator('.receipt-item')).to_have_count(2)
        milk=modal.locator('.receipt-item').filter(has=page.locator('[data-field=texto][value="LEITE FICTICIO"]'))
        expect(milk.locator('[data-field=quantidade]')).to_have_value('2')
        expect(milk.locator('[data-field=preco]')).to_have_value('5,5')
        expect(milk.locator('[data-field=source]')).to_have_value('leite')
        modal.get_by_role('button',name='Confirmar e guardar compra').click()
        expect(modal.locator('[role=alert]')).to_contain_text('Marque que conferiu')
        assert page.evaluate('Store.exportAll()')==initial
        milk.locator('[data-field=preco]').fill('5,45')
        modal.locator('[name=revisado]').check()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        modal.get_by_role('button',name='Confirmar e guardar compra').click()
        expect(modal).not_to_be_visible()
        final=page.evaluate('Store.exportAll()')
        ledger=list(final['compra'].values())
        assert len(ledger)==1 and ledger[0]['origem']=='nota-revisada'
        assert ledger[0]['total']==19.9 and len(ledger[0]['itens'])==2
        assert ledger[0]['itens'][0]['preco']==5.45
        assert 'leite' not in final['item']
        assert final['item']['pendente']==initial['item']['pendente']
        assert not final.get('recado') and not final.get('conta') and not final.get('tarefa')
        assert not errors, errors
        assert all(urlparse(u).hostname=='fonts.googleapis.com' for u in external),external
        print('OK OCR ponta a ponta real: nota fictícia -> campos corretos -> revisão/correção -> ledger -> pendente preservado; sem transmissão externa')
        browser.close()
finally:
    server.shutdown()
