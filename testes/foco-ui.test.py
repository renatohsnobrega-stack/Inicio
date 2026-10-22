"""Teste de interface do Foco, sem acesso à produção.
Rodar: python3 testes/foco-ui.test.py
Requer playwright (Python) e Chromium local ou `playwright install chromium`.
O servidor aceita apenas localhost e config.js é substituído no navegador.
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
        page.add_init_script("""(() => {
          if (localStorage.getItem('foco-ui-seeded')) return;
          const hoje = new Date();
          const dia = `${hoje.getFullYear()}-${String(hoje.getMonth()+1).padStart(2,'0')}-${String(hoje.getDate()).padStart(2,'0')}`;
          const tarefa = (id, titulo, responsavel, foco) => ({id,titulo,responsavel,tipo:'unica',data:dia,foco,feito:false});
          localStorage.setItem('casa-organizada:v1', JSON.stringify({
            config: {pessoas:{id:'pessoas',nomes:['Renato','Vanessa','Antônio'],filhos:['Antônio']}},
            tarefa: {
              a:tarefa('a','Tarefa fictícia A','Renato',{Renato:dia}),
              b:tarefa('b','Tarefa fictícia B','Ambos',{Renato:dia,Vanessa:dia}),
              c:tarefa('c','Tarefa fictícia Vanessa','Vanessa',{Vanessa:dia})
            },
            lista: {l:{id:'l',nome:'Lista fictícia'}},
            item: {i:{id:'i',texto:'Item fictício',lista:'l',prazo:dia,foco:{Renato:dia},feito:false}}
          }));
          localStorage.setItem('casa:eu','Renato');
          localStorage.setItem('foco-ui-seeded','1');
        })();""")
        page.goto(url + '/#/tarefas')
        expect(page.get_by_role('heading', name='Tarefas', exact=True)).to_be_visible()
        panel = lambda: page.locator('section.panel').filter(has=page.get_by_role('heading', name='Foco do dia', exact=False))
        row = lambda title: panel().locator('.pend').filter(has=page.locator('strong', has_text=title))

        # Começar, cancelar pausa, nota escapada, recarregar, retomar e trocar de foco.
        row('Tarefa fictícia A').get_by_role('button', name='Começar', exact=True).click()
        expect(row('Tarefa fictícia A').get_by_text('Em andamento', exact=True)).to_be_visible()
        row('Tarefa fictícia A').get_by_role('button', name='Pausar', exact=True).click()
        page.get_by_role('button', name='Cancelar', exact=True).click()
        expect(row('Tarefa fictícia A').get_by_text('Em andamento', exact=True)).to_be_visible()
        row('Tarefa fictícia A').get_by_role('button', name='Pausar', exact=True).click()
        note = 'Abrir <documento> & conferir\nContinuar aqui'
        page.get_by_label('Próximo passo (opcional)').fill(note)
        page.locator('#modal').get_by_role('button', name='Pausar', exact=True).click()
        expect(row('Tarefa fictícia A').get_by_text('Pausada', exact=True)).to_be_visible()
        assert row('Tarefa fictícia A').locator('.focus-note').inner_text() == 'Próximo passo: ' + note
        assert row('Tarefa fictícia A').locator('documento').count() == 0
        page.reload()
        expect(row('Tarefa fictícia A').get_by_role('button', name='Retomar')).to_be_visible()
        row('Tarefa fictícia A').get_by_role('button', name='Retomar').click()
        row('Tarefa fictícia B').get_by_role('button', name='Começar').click()
        expect(row('Tarefa fictícia A').get_by_text('Pausada', exact=True)).to_be_visible()
        assert panel().get_by_text('Em andamento', exact=True).count() == 1

        # Nota opcional vazia e itens de lista no mesmo fluxo.
        row('Tarefa fictícia B').get_by_role('button', name='Pausar', exact=True).click()
        page.locator('#modal').get_by_role('button', name='Pausar', exact=True).click()
        expect(row('Tarefa fictícia B').get_by_role('button', name='Retomar')).to_be_visible()
        row('Item fictício').get_by_role('button', name='Começar').click()
        expect(row('Item fictício').get_by_text('Em andamento', exact=True)).to_be_visible()

        # Outra aba pessoal não revela controles nem notas da conta atual.
        page.locator('[data-action="pick-tar-pessoa"][data-pessoa="Vanessa"]').click()
        assert panel().locator('.focus-controls').count() == 0
        assert panel().locator('.focus-note').count() == 0
        page.locator('[data-action="pick-tar-pessoa"][data-pessoa="Renato"]').click()

        # Conclusão e reabertura não deixam execução fantasma.
        row('Tarefa fictícia A').get_by_role('checkbox').check()
        assert row('Tarefa fictícia A').locator('.focus-controls').count() == 0
        row('Tarefa fictícia A').get_by_role('checkbox').uncheck()
        expect(row('Tarefa fictícia A').get_by_role('button', name='Começar')).to_be_visible()

        # Ambos: conclusão/reabertura por Vanessa não ressuscita a execução de Renato.
        row('Tarefa fictícia B').get_by_role('button', name='Retomar').click()
        page.evaluate("D.setEu('Vanessa')")
        page.reload()
        expect(row('Tarefa fictícia B').get_by_role('button', name='Começar')).to_be_visible()
        row('Tarefa fictícia B').get_by_role('button', name='Começar').click()
        row('Tarefa fictícia B').get_by_role('checkbox').check()
        row('Tarefa fictícia B').get_by_role('checkbox').uncheck()
        page.evaluate("D.setEu('Renato')")
        page.reload()
        expect(row('Tarefa fictícia B').get_by_role('button', name='Começar')).to_be_visible()
        row('Tarefa fictícia B').get_by_role('button', name='Começar').click()

        # Painel usa o mesmo estado e os mesmos controles; sem overflow a 390px.
        page.goto(url + '/#/painel')
        expect(page.locator('.focus-controls').get_by_role('button', name='Pausar')).to_be_visible()
        page.set_viewport_size({'width': 320, 'height': 740})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        page.set_viewport_size({'width': 1280, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
        assert not errors, errors
        assert not any('supabase' in target for target in blocked), blocked
        browser.close()
        print('ok - Começar/Pausar/Retomar, cancelar, nota opcional/escapada, reload, foco único, Ambos entre pessoas, itens, outra pessoa, concluir/reabrir, Painel e telas 320/390/1280px; sem produção')
finally:
    server.shutdown()
    server.server_close()
