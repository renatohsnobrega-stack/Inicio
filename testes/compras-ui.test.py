"""MVP compras em viewport móvel; somente dados fictícios e servidor local.
Rodar: python3 testes/compras-ui.test.py
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
import json
import shutil
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', accept_downloads=True)
        def route_request(route):
            target = urlparse(route.request.url)
            if target.hostname != '127.0.0.1':
                route.abort()
            elif target.path == '/config.js':
                route.fulfill(content_type='application/javascript', body='window.APP_CONFIG = {};')
            else:
                route.continue_()
        context.route('**/*', route_request)
        page = context.new_page()
        page.on('pageerror', lambda err: errors.append(str(err)))
        dialogs = []
        page.on('dialog', lambda dlg: (dialogs.append(dlg.message), dlg.accept()))
        page.add_init_script("""if (!localStorage.getItem('compras-ui-seeded')) {
          localStorage.setItem('casa-organizada:v1', JSON.stringify({
            config: {pessoas: {id:'pessoas', nomes:['Pessoa fictícia', 'Outra pessoa'], filhos:[]}},
            lista: {mercado:{id:'mercado',nome:'Mercado fictício',icone:'🛒'},outra:{id:'outra',nome:'Outra lista'}},
            item: {
              leite:{id:'leite',lista:'mercado',texto:'Leite fictício',feito:false},
              arroz:{id:'arroz',lista:'mercado',texto:'Arroz fictício',feito:false},
              outro:{id:'outro',lista:'outra',texto:'Fora da compra',feito:true}
            },
            conta:{inalterada:{id:'inalterada',nome:'Conta fictícia',tipo:'unica',data:'2026-10-22',valor:42,revisado:true}},
            recado:{inalterado:{id:'inalterado',texto:'Não alterar',curtidas:[],em:'2026-10-22T00:00:00Z'}}
          }));
          localStorage.setItem('compras-ui-seeded','1');
        }""")
        base = f'http://127.0.0.1:{server.server_port}'
        page.goto(base + '/#/listas')
        expect(page.get_by_role('heading', name='Listas compartilhadas')).to_be_visible()
        page.locator('[data-action=pick-list][data-id=mercado]').click()
        export = lambda: page.evaluate('Store.exportAll()')
        initial = export()
        assert not initial.get('compra')
        assert page.get_by_role('button', name='Limpar marcados').count() == 0
        page.get_by_role('button', name='Finalizar compra', exact=True).click()
        assert 'Marque pelo menos' in dialogs[-1]
        assert not export().get('compra')

        # Cancelar seleção não modifica itens. Catálogo inclui os ainda não concluídos.
        page.get_by_role('button', name='Escolher produtos', exact=True).click()
        modal = page.locator('#modal')
        expect(modal.locator('[name=produto]')).to_have_count(2)
        assert 'Fora da compra' not in modal.inner_text()
        modal.get_by_role('button', name='Cancelar', exact=True).click()
        assert export() == initial

        # Item avulso continua disponível, inclusive caracteres que precisam de escape.
        quick = page.locator('form[data-form=item]')
        quick.locator('[name=texto]').fill('Produto <fictício> & teste')
        quick.get_by_role('button', name='Adicionar', exact=True).click()
        expect(page.locator('main')).to_contain_text('Produto <fictício> & teste')
        page.locator('[data-action=toggle-item][data-id=leite]').check()
        page.get_by_role('button', name='Finalizar compra', exact=True).click()
        expect(modal).to_be_visible()
        form = modal.locator('form')
        form.locator('[name=loja]').fill('Loja fictícia')
        form.locator('[name=total]').fill('12,90')
        form.locator('[name=q0]').fill('-2')
        form.locator('[name=u0]').fill('L')
        form.locator('[name=p0]').fill('6,45')
        form.get_by_role('button', name='Guardar compra no histórico').click()
        expect(modal.locator('[role=alert]')).not_to_be_empty()
        assert not export().get('compra')
        form.locator('[name=q0]').fill('2')
        form.get_by_role('button', name='Guardar compra no histórico').click()
        expect(modal).not_to_be_visible()
        data = export()
        compras = list(data['compra'].values())
        assert len(compras) == 1
        compra = compras[0]
        assert compra['loja'] == 'Loja fictícia' and compra['total'] == 12.9
        assert compra['itens'][0]['quantidade'] == 2 and compra['itens'][0]['preco'] == 6.45
        assert compra['itens'][0]['unidade'] == 'L'
        assert 'leite' not in data['item']
        assert data['item']['arroz']['feito'] is False
        assert data['item']['outro'] == initial['item']['outro']
        assert data['conta'] == initial['conta'] and data['recado'] == initial['recado']
        assert not data.get('tarefa')
        expect(page.locator('.purchase-history')).to_contain_text('Loja fictícia')
        expect(page.locator('.purchase-history')).to_contain_text('Anexos disponíveis no modo nuvem')

        # Próxima compra: produto comprado antes é recuperado sem reescrever.
        page.get_by_role('button', name='Escolher produtos', exact=True).click()
        form = modal.locator('form')
        label = form.locator('label.check-row').filter(has_text='Leite fictício')
        label.locator('input').check()
        form.get_by_role('button', name='Adicionar selecionados').click()
        expect(modal).not_to_be_visible()
        items = [i for i in export()['item'].values() if i['lista'] == 'mercado' and i['texto'] == 'Leite fictício']
        assert len(items) == 1 and items[0]['feito'] is False
        # Selecionar de novo não duplica nem altera os pendentes.
        before = export()
        page.get_by_role('button', name='Escolher produtos', exact=True).click()
        modal.locator('label.check-row').filter(has_text='Leite fictício').locator('input').check()
        modal.get_by_role('button', name='Adicionar selecionados').click()
        expect(modal).not_to_be_visible()
        assert export() == before

        # Nova lista selecionando produtos da anterior, sem apagá-la.
        page.get_by_role('button', name='Escolher produtos', exact=True).click()
        modal.locator('[name=nova]').fill('Próxima fictícia')
        modal.locator('label.check-row').filter(has_text='Arroz fictício').locator('input').check()
        modal.get_by_role('button', name='Adicionar selecionados').click()
        expect(modal).not_to_be_visible()
        data = export()
        nova = next(l for l in data['lista'].values() if l['nome'] == 'Próxima fictícia')
        assert any(i['lista'] == nova['id'] and i['texto'] == 'Arroz fictício' for i in data['item'].values())
        assert data['item']['arroz'] == before['item']['arroz']
        page.locator('[data-action=pick-list][data-id=mercado]').click()

        # JSON portátil com os dados, não base64 da nota.
        with page.expect_download() as info:
            page.get_by_role('button', name='Exportar JSON', exact=True).click()
        result = json.loads(Path(info.value.path()).read_text())
        assert len(result['compras']) == 1 and result['resumo']['total'] == 12.9
        assert 'base64' not in json.dumps(result)
        page.reload()
        page.locator('[data-action=pick-list][data-id=mercado]').click()
        expect(page.locator('.purchase-history')).to_contain_text('Loja fictícia')
        # Filtro não modifica histórico e lista com compras não pode desaparecer.
        page.locator('[data-action=purchase-month]').fill('2000-01')
        expect(page.locator('.purchase-history')).to_contain_text('Nenhuma compra neste período')
        page.get_by_role('button', name='Todo o histórico', exact=True).click()
        expect(page.locator('.purchase-history')).to_contain_text('Loja fictícia')
        page.get_by_role('button', name='Editar / excluir lista', exact=True).click()
        modal.get_by_role('button', name='Excluir', exact=True).click()
        assert any('tem histórico de compras' in msg for msg in dialogs)
        modal.get_by_role('button', name='Cancelar', exact=True).click()
        assert export()['lista']['mercado']['nome'] == 'Mercado fictício'

        # Caminho de UI cloud com funções simuladas: não abre conexão externa.
        page.evaluate("""() => {
          Store.mode = () => 'cloud';
          Store.attachPurchaseReceipt = async () => { throw new Error('Falha fictícia de rede'); };
        }""")
        page.locator('[data-action=pick-list][data-id=mercado]').click()
        before_receipt = export()
        receipt = {'name':'nota-ficticia.pdf','mimeType':'application/pdf','buffer':b'%PDF-1.4\n%%EOF'}
        page.locator('[data-action=purchase-receipt]').set_input_files(receipt)
        assert 'nota não foi confirmada' in dialogs[-1]
        assert export() == before_receipt
        page.evaluate("""() => {
          Store.attachPurchaseReceipt = async (id, file) => Store.putConfirmed('compra', {
            ...Store.get('compra', id), nota: {path: 'familia/' + id + '/simulado.pdf', nome:file.name, type:file.type, size:file.size}
          });
        }""")
        page.locator('[data-action=purchase-receipt]').set_input_files(receipt)
        expect(page.get_by_role('button', name='Abrir nota fiscal')).to_be_visible()
        assert list(export()['compra'].values())[0]['nota']['nome'] == 'nota-ficticia.pdf'
        assert list(export()['compra'].values())[0]['itens'] == compra['itens']
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.set_viewport_size({'width':320,'height':750})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert errors == [], errors
        print('OK compras UI: catálogo, avulso, validação, histórico, reutilização, nova lista, persistência, exportação e isolamento móvel')
        browser.close()
finally:
    server.shutdown()
