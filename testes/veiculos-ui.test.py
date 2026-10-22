"""Teste local da tela Veículos, sem acesso à produção.
Rodar: python3 testes/veiculos-ui.test.py
Requer Playwright (Python) e Chromium local. config.js é vazio e service workers são bloqueados.
"""
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import shutil
import threading
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
LS_KEY = 'casa-organizada:v1'
TODAY = date.today()


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}'
errors, blocked, dialogs = [], [], []

# PNG transparente real de 1x1 pixel; PDF mínimo com cabeçalho válido.
PNG_1X1 = bytes.fromhex(
    '89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c02'
    '0000000b49444154789c636000020000050001a5f645400000000049454e44ae426082'
)
PDF_TINY = (
    b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    b'2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n'
    b'trailer\n<< /Root 1 0 R >>\n%%EOF\n'
)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=shutil.which('chromium'), args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block', accept_downloads=True)

        def route_request(route):
            target = route.request.url
            parsed = urlparse(target)
            if parsed.hostname != '127.0.0.1':
                blocked.append(target)
                route.abort()
            elif parsed.path == '/config.js':
                route.fulfill(content_type='application/javascript', body='')
            else:
                route.continue_()

        context.route('**/*', route_request)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))

        def handle_dialog(dialog):
            dialogs.append((dialog.type, dialog.message))
            dialog.accept()

        page.on('dialog', handle_dialog)
        page.add_init_script("""(() => {
          if (localStorage.getItem('veiculos-ui-seeded')) return;
          // Estado inteiramente fictício: apenas configuração (sem remédios/estoque,
          // contas, tarefas ou recados), para comprovar que os outros módulos não mudam.
          localStorage.setItem('casa-organizada:v1', JSON.stringify({
            config: {pessoas: {id: 'pessoas', nomes: ['Renato', 'Vanessa'], filhos: []}}
          }));
          localStorage.setItem('casa:eu', 'Renato');
          localStorage.setItem('veiculos-ui-seeded', '1');
        })();""")
        page.goto(url + '/#/veiculos')
        expect(page.locator('main h1')).to_have_text('Veículos')
        storage = lambda: page.evaluate("JSON.parse(localStorage.getItem('casa-organizada:v1'))")
        export_all = lambda: page.evaluate('Store.exportAll()')
        initial_storage = storage()
        initial_export = export_all()
        assert initial_export == initial_storage
        assert not initial_export.get('veiculo') and not initial_export.get('registro_veiculo')
        assert 'remedio' not in initial_export  # nada que possa criar escrita de estoque
        expect(page.get_by_text('Nenhum veículo cadastrado.', exact=False)).to_be_visible()
        assert page.get_by_role('button', name='+ Registro', exact=True).count() == 0
        assert storage() == initial_storage, 'A tela vazia não deve criar veículos ou registros.'

        # Cancelamento não persiste.
        page.get_by_role('button', name='+ Veículo', exact=True).click()
        form = page.locator('#modal form')
        form.locator('[name="nome"]').fill('Cancelado fictício')
        form.get_by_role('button', name='Cancelar', exact=True).click()
        assert storage() == initial_storage and export_all() == initial_export

        def add_vehicle(name, plate, model):
            page.get_by_role('button', name='+ Veículo', exact=True).click()
            f = page.locator('#modal form')
            f.locator('[name="nome"]').fill(name)
            f.locator('[name="placa"]').fill(plate)
            f.locator('[name="modelo"]').fill(model)
            f.get_by_role('button', name='Salvar', exact=True).click()
            expect(page.locator('#modal')).not_to_be_visible()

        add_vehicle('Sedan Verde', 'FIC-2040', 'Modelo fictício 2020')
        add_vehicle('Hatch Azul', 'FIC-3040', 'Modelo fictício 2022')
        exported = export_all()
        cars = {v['nome']: v for v in exported['veiculo'].values()}
        car1, car2 = cars['Sedan Verde'], cars['Hatch Azul']
        assert (car1['placa'], car1['modelo']) == ('FIC-2040', 'Modelo fictício 2020')
        assert (car2['placa'], car2['modelo']) == ('FIC-3040', 'Modelo fictício 2022')
        assert exported['config'] == initial_export['config']
        for untouched in ('conta', 'tarefa', 'recado', 'remedio'):
            assert exported.get(untouched) == initial_export.get(untouched), f'{untouched} foi alterado'

        def new_record(vehicle_id, kind, title, *, status='pendente', due='', defense='', appeal='', files=None):
            page.get_by_role('button', name='+ Registro', exact=True).click()
            f = page.locator('#modal form')
            f.locator('[name="veiculo"]').select_option(vehicle_id)
            f.locator('[name="tipo"]').select_option(kind)
            expect(f.locator('[name="titulo"]')).to_be_visible()
            f.locator('[name="titulo"]').fill(title)
            f.locator('[name="data"]').fill(TODAY.isoformat())
            assert f.locator('[name="responsavel"]').input_value() == 'Renato', 'Responsável deve seguir D.eu()'
            if status:
                f.locator('[name="status"]').select_option(status)
            if due:
                f.locator('[name="prazo"]').fill(due)
            if defense:
                f.locator('[name="prazoDefesa"]').fill(defense)
            if appeal:
                f.locator('[name="prazoRecurso"]').fill(appeal)
            if files:
                f.locator('input[name="anexos"]').set_input_files(files)
            return f

        # Registro anual e OBD com dois anexos pequenos, de assinaturas reais.
        annual = new_record(car1['id'], 'anual', 'Revisão anual fictícia', due=(TODAY + timedelta(days=365)).isoformat())
        annual.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        obd_files = [
            {'name': 'laudo-obd.pdf', 'mimeType': 'application/pdf', 'buffer': PDF_TINY},
            {'name': 'captura-obd.png', 'mimeType': 'image/png', 'buffer': PNG_1X1},
        ]
        obd = new_record(car2['id'], 'obd', 'Diagnóstico OBD fictício', files=obd_files)
        obd.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        multa_due = (TODAY + timedelta(days=30)).isoformat()
        multa_defense = (TODAY + timedelta(days=10)).isoformat()
        multa_appeal = (TODAY + timedelta(days=50)).isoformat()
        multa = new_record(car1['id'], 'multa', 'Notificação fictícia de multa', due=multa_due,
                           defense=multa_defense, appeal=multa_appeal)
        assert multa.locator('[name="prazo"]').input_value() == multa_due
        assert multa.locator('[name="prazoDefesa"]').input_value() == multa_defense
        assert multa.locator('[name="prazoRecurso"]').input_value() == multa_appeal
        multa.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()

        state = export_all()
        records = {r['titulo']: r for r in state['registro_veiculo'].values()}
        annual_rec = records['Revisão anual fictícia']
        obd_rec = records['Diagnóstico OBD fictício']
        multa_rec = records['Notificação fictícia de multa']
        assert annual_rec['tipo'] == 'anual' and annual_rec['status'] == 'pendente'
        assert multa_rec['prazo'] == multa_due
        assert multa_rec['prazoDefesa'] == multa_defense and multa_rec['prazoRecurso'] == multa_appeal
        assert [a['nome'] for a in obd_rec['anexos']] == ['laudo-obd.pdf', 'captura-obd.png']
        assert state['config'] == initial_export['config']
        assert all(state.get(k) == initial_export.get(k) for k in ('conta', 'tarefa', 'recado', 'remedio'))

        # Grupos separam multas de manutenção/OBD.
        maintenance_group = page.locator('section.panel').filter(
            has=page.get_by_role('heading', name='Manutenções e diagnósticos OBD', exact=True))
        tickets_group = page.locator('section.panel').filter(
            has=page.get_by_role('heading', name='Multas de trânsito', exact=True))
        expect(maintenance_group.get_by_role('heading', name='Revisão anual fictícia')).to_be_visible()
        expect(maintenance_group.get_by_role('heading', name='Diagnóstico OBD fictício')).to_be_visible()
        expect(tickets_group.get_by_role('heading', name='Notificação fictícia de multa')).to_be_visible()
        ticket = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Notificação fictícia de multa', exact=True))
        expect(ticket.locator('p.small').filter(has_text='Defesa:')).to_contain_text(
            __import__('datetime').date.fromisoformat(multa_defense).strftime('%d/%m/%Y'))
        expect(ticket.locator('p.small').filter(has_text='Recurso:')).to_contain_text(
            __import__('datetime').date.fromisoformat(multa_appeal).strftime('%d/%m/%Y'))

        # Filtros independentes: veículo, tipo e status.
        vehicle_filter = page.locator('select[data-key="veiculo"]')
        type_filter = page.locator('select[data-key="veiculoTipo"]')
        status_filter = page.locator('select[data-key="veiculoStatus"]')
        vehicle_filter.select_option(car2['id'])
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Diagnóstico OBD fictício')).to_be_visible()
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Revisão anual fictícia')).to_have_count(0)
        type_filter.select_option('multa')
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Diagnóstico OBD fictício')).to_have_count(0)
        vehicle_filter.select_option('')
        type_filter.select_option('anual')
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Revisão anual fictícia')).to_be_visible()
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Diagnóstico OBD fictício')).to_have_count(0)
        type_filter.select_option('')

        # Baixar anexo e comparar byte a byte com o arquivo submetido.
        obd_card = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Diagnóstico OBD fictício', exact=True))
        with page.expect_download() as download_info:
            obd_card.get_by_role('button', name='Baixar: laudo-obd.pdf', exact=True).click()
        download = download_info.value
        assert download.suggested_filename == 'laudo-obd.pdf'
        assert Path(download.path()).read_bytes() == PDF_TINY

        # Remover o PDF existente e salvar somente o PNG.
        obd_card.get_by_role('button', name='Editar registro', exact=True).click()
        edit = page.locator('#modal form')
        expect(edit.locator('input[name="anexos-keep"]')).to_have_count(2)
        edit.locator('input[name="anexos-keep"]').nth(0).uncheck()
        edit.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        obd_rec = next(r for r in export_all()['registro_veiculo'].values() if r['titulo'] == 'Diagnóstico OBD fictício')
        assert [a['nome'] for a in obd_rec['anexos']] == ['captura-obd.png']
        obd_card = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Diagnóstico OBD fictício', exact=True))
        expect(obd_card.get_by_role('button', name='Baixar: laudo-obd.pdf')).to_have_count(0)
        with page.expect_download() as download_info:
            obd_card.get_by_role('button', name='Baixar: captura-obd.png', exact=True).click()
        assert Path(download_info.value.path()).read_bytes() == PNG_1X1

        # Reatribuir registro para o outro veículo, com histórico intacto.
        annual_row = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Revisão anual fictícia', exact=True))
        annual_row.get_by_role('button', name='Editar registro', exact=True).click()
        edit = page.locator('#modal form')
        edit.locator('[name="veiculo"]').select_option(car2['id'])
        edit.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        reattributed = next(r for r in export_all()['registro_veiculo'].values() if r['titulo'] == 'Revisão anual fictícia')
        assert reattributed['veiculo'] == car2['id']
        annual_row = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Revisão anual fictícia', exact=True))
        expect(annual_row).to_contain_text('Hatch Azul')

        # Datas civis inválidas: browsers podem limpar inputs date; injeta-se o valor
        # inválido no getter do controle, após tentar fill, para exercitar o validador app.
        new_record(car1['id'], 'multa', 'Multa com prazo inválido')
        invalid_form = page.locator('#modal form')
        invalid_input = invalid_form.locator('[name="prazoDefesa"]')
        try:
            invalid_input.fill('2025-02-30')
        except Exception:
            pass
        page.evaluate("""() => {
          const el = document.querySelector('#modal [name="prazoDefesa"]');
          Object.defineProperty(el, 'value', {configurable: true, get: () => '2025-02-30'});
        }""")
        invalid_form.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal form')).to_be_visible()
        assert dialogs and ('data inválida' in dialogs[-1][1].lower() or 'defesa' in dialogs[-1][1].lower()), dialogs
        assert not any(r['titulo'] == 'Multa com prazo inválido' for r in export_all()['registro_veiculo'].values())
        page.evaluate("""() => { const el = document.querySelector('#modal [name="prazoDefesa"]'); delete el.value; }""")
        invalid_form.get_by_role('button', name='Cancelar', exact=True).click()

        # Recusar upload maior que 1 MB e HTML.
        before_invalid_upload = export_all()
        too_large_form = new_record(car1['id'], 'obd', 'Upload excede limite', files=[{
            'name': 'grande.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-' + b'x' * (1024 * 1024)
        }])
        too_large_form.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal form')).to_be_visible()
        assert '1 MB' in dialogs[-1][1] or 'anexo' in dialogs[-1][1].lower(), dialogs[-1]
        assert export_all() == before_invalid_upload
        too_large_form.locator('[name="anexos"]').set_input_files({
            'name': 'executavel.html', 'mimeType': 'text/html', 'buffer': b'<html>nao executado</html>'
        })
        too_large_form.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal form')).to_be_visible()
        assert 'PDF, PNG' in dialogs[-1][1] or 'anexo' in dialogs[-1][1].lower(), dialogs[-1]
        assert export_all() == before_invalid_upload
        # MIME permitido, assinatura errada: validação real do conteúdo, não só extensão.
        too_large_form.locator('[name="anexos"]').set_input_files({
            'name': 'imagem-falsa.png', 'mimeType': 'image/png', 'buffer': b'%PDF-isto-nao-e-PNG'
        })
        selected_file = page.locator('#modal input[name="anexos"]').evaluate(
            "el => el.files.length ? [el.files[0].type, el.files[0].size, el.files[0].name] : null")
        assert selected_file == ['image/png', len(b'%PDF-isto-nao-e-PNG'), 'imagem-falsa.png'], selected_file
        previous_dialog_count = len(dialogs)
        too_large_form.get_by_role('button', name='Salvar', exact=True).click()
        for _ in range(40):
            if len(dialogs) > previous_dialog_count:
                break
            page.wait_for_timeout(50)
        expect(page.locator('#modal form')).to_be_visible()
        assert 'tipo informado' in dialogs[-1][1].lower(), dialogs[-1]
        assert export_all() == before_invalid_upload
        too_large_form.get_by_role('button', name='Cancelar', exact=True).click()

        # Resolver manualmente multa e filtrar status (sem interpretar como pagamento automático).
        ticket = page.locator('article.vehicle-entry').filter(
            has=page.get_by_role('heading', name='Notificação fictícia de multa', exact=True))
        ticket.get_by_role('button', name='Editar registro', exact=True).click()
        edit = page.locator('#modal form')
        edit.locator('[name="status"]').select_option('resolvido')
        edit.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        resolved = next(r for r in export_all()['registro_veiculo'].values() if r['titulo'] == 'Notificação fictícia de multa')
        assert resolved['status'] == 'resolvido'
        status_filter.select_option('resolvido')
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Notificação fictícia de multa')).to_be_visible()
        expect(page.locator('article.vehicle-entry').get_by_role('heading', name='Revisão anual fictícia')).to_have_count(0)
        status_filter.select_option('')

        # Impedir apagar veículo ainda referenciado; não apaga em cascata nem fecha o modal.
        vehicle_row = page.locator('.row').filter(has=page.get_by_text('Sedan Verde', exact=True)).first
        vehicle_row.get_by_role('button', name='Editar veículo', exact=True).click()
        delete_form = page.locator('#modal form')
        before_delete = export_all()
        delete_form.get_by_role('button', name='Excluir', exact=True).click()
        expect(page.locator('#modal form')).to_be_visible()
        assert any('registros' in msg.lower() and 'exclua-os primeiro' in msg.lower() for _, msg in dialogs), dialogs
        assert export_all() == before_delete
        delete_form.get_by_role('button', name='Cancelar', exact=True).click()

        # Falha real simulada de localStorage.setItem: estado persistido/cache não muda,
        # modal continua aberto com campos, e retry após restaurar o storage funciona.
        before_failure_storage = storage()
        before_failure_export = export_all()
        page.get_by_role('button', name='+ Veículo', exact=True).click()
        failure_form = page.locator('#modal form')
        failure_form.locator('[name="nome"]').fill('Veículo após retry')
        failure_form.locator('[name="placa"]').fill('FIC-4040')
        failure_form.locator('[name="modelo"]').fill('Modelo fictício 2024')
        page.evaluate("""key => {
          const proto = Storage.prototype;
          window.__originalSetItem = proto.setItem;
          window.__failVehicleWrite = true;
          proto.setItem = function(k, v) {
            if (k === key && window.__failVehicleWrite) {
              window.__failVehicleWrite = false;
              throw new Error('QuotaExceededError simulado');
            }
            return window.__originalSetItem.call(this, k, v);
          };
        }""", LS_KEY)
        try:
            failure_form.get_by_role('button', name='Salvar', exact=True).click()
            expect(page.locator('#modal form')).to_be_visible()
            assert 'Não foi possível salvar' in dialogs[-1][1], dialogs[-1]
            assert storage() == before_failure_storage
            assert export_all() == before_failure_export
            expect(failure_form.locator('[name="nome"]')).to_have_value('Veículo após retry')
        finally:
            page.evaluate("""() => {
              if (window.__originalSetItem) Storage.prototype.setItem = window.__originalSetItem;
              delete window.__originalSetItem; delete window.__failVehicleWrite;
            }""")
        failure_form.get_by_role('button', name='Salvar', exact=True).click()
        expect(page.locator('#modal')).not_to_be_visible()
        assert any(v['nome'] == 'Veículo após retry' for v in export_all()['veiculo'].values())

        # Backup pelo Store.exportAll e persistência após reload, incluindo anexo mantido.
        backup = export_all()
        assert backup['registro_veiculo'][obd_rec['id']]['anexos'][0]['nome'] == 'captura-obd.png'
        page.reload()
        expect(page.locator('main h1')).to_have_text('Veículos')
        after_reload = export_all()
        assert after_reload == backup
        expect(page.get_by_role('heading', name='Diagnóstico OBD fictício', exact=True)).to_be_visible()
        expect(page.get_by_role('button', name='Baixar: captura-obd.png', exact=True)).to_be_visible()
        assert storage()['config'] == initial_storage['config']
        for untouched in ('conta', 'tarefa', 'recado', 'remedio'):
            assert after_reload.get(untouched) == initial_export.get(untouched), f'{untouched} foi alterado'

        # Verificação de overflow em desktop e no viewport mobile solicitado.
        for width, height in [(390, 844), (1280, 900)]:
            page.set_viewport_size({'width': width, 'height': height})
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'overflow em {width}px'
        assert not errors, errors
        assert not any('supabase' in target.lower() for target in blocked), blocked
        browser.close()
        print('ok - Veículos vazio sem autocriação, cancelamento, cadastro, manutenção anual/OBD/multa, anexos PDF/PNG (remoção e download byte a byte), prazos distintos, filtros, reatribuição, status resolvido, validações, exclusão vinculada, falha/retry localStorage, backup/reload, Renato, estado alheio intacto; 390/1280px; sem produção')
finally:
    server.shutdown()
    server.server_close()
