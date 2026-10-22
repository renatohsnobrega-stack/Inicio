"""Real Chromium tests for ReceiptOCR; network is denied except the local test server."""
from __future__ import annotations
import json
import os
from pathlib import Path
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
TEST_DIR = Path(__file__).resolve().parent

class QuietHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *_args):
        pass


def main():
    if not (TEST_DIR / "fixtures/nota-ficticia.png").exists():
        raise SystemExit("Fixtures missing; run python3 testes/ocr/build_fixtures.py first.")
    server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
    if not executable:
        for candidate in (
            "/opt/manus/playwright/chromium-1234/chrome-linux64/chrome",
            "/opt/google/chrome/chrome",
            shutil.which("chromium"),
            shutil.which("chromium-browser"),
            shutil.which("google-chrome"),
        ):
            if candidate and Path(candidate).is_file():
                executable = candidate
                break
    requested = []
    blocked = []
    checks = []
    def check(condition, message):
        if not condition:
            raise AssertionError(message)
        checks.append(message)

    try:
        with sync_playwright() as p:
            launch = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
            if executable:
                launch["executable_path"] = executable
            browser = p.chromium.launch(**launch)
            context = browser.new_context()
            page = context.new_page()
            def guard(route):
                parsed = urlparse(route.request.url)
                requested.append(route.request.url)
                if parsed.scheme in ("http", "https") and parsed.hostname in ("127.0.0.1", "localhost") and parsed.port == server.server_port:
                    route.continue_()
                else:
                    blocked.append(route.request.url)
                    route.abort()
            page.route("**/*", guard)
            page.goto(origin + "/testes/ocr/standalone.html", wait_until="load")
            check(not any("/vendor/ocr/" in u for u in requested), "OCR/PDF binaries are lazy (nothing downloaded before explicit use)")

            def read_fixture(name, mime):
                page.locator("#file").set_input_files({"name": name, "mimeType": mime, "buffer": (TEST_DIR / "fixtures" / name).read_bytes()})
                page.evaluate("window.lastResult = null")
                page.locator("#read").click()
                page.wait_for_function("window.lastResult !== null", timeout=180000)
                return page.evaluate("window.lastResult")

            result = read_fixture("nota-ficticia.png", "image/png")
            check("NOTA FICTICIA" in result.get("text", "").upper() and "TOTAL" in result.get("text", "").upper(), f"real Tesseract OCR recognized synthetic image: {result}")
            check(result.get("pages") == 1 and result.get("confidence") is not None and isinstance(result.get("warnings"), list), "image result contract includes confidence/pages/warnings")
            progress = json.loads(page.locator("#progress").inner_text())
            check(progress.get("fraction") == 1 and "concluída" in progress.get("message", ""), "progress callback reports Portuguese message and 0–1 fraction")
            image_paths = [urlparse(u).path for u in requested]
            check(any(p.endswith("/tesseract/tesseract.min.js") for p in image_paths), "Tesseract.js loaded from same-origin local vendor")
            check(any("/core/" in p and p.endswith(".wasm.js") for p in image_paths), "Tesseract WASM loader loaded from same-origin local vendor")
            check(any(p.endswith("/por.traineddata.gz") for p in image_paths), "Portuguese traineddata loaded from same-origin local vendor")
            check(not any("/pdfjs/" in p for p in image_paths), "image OCR does not fetch the unused PDF.js engine")

            result = read_fixture("nota-texto-ficticia.pdf", "application/pdf")
            text = result.get("text", "")
            check("PDF FICTICIO" in text and "CAFE 1,50" in text and "TOTAL 1,50" in text, f"real PDF.js text extraction preserves receipt lines: {result}")
            check(text.count("\n") >= 2 and result.get("confidence") is None and result.get("pages") == 1, "native PDF text returns line breaks, null OCR confidence and exact page count")

            result = read_fixture("nota-raster-ficticia.pdf", "application/pdf")
            check("NOTA FICTICIA" in result.get("text", "").upper() and "TOTAL" in result.get("text", "").upper(), f"scanned PDF page is rendered and OCRed: {result}")
            check(result.get("pages") == 1 and result.get("confidence") is not None, "scanned PDF reports OCR confidence and page count")

            result = read_fixture("nota-hibrida-texto-raster-ficticia.pdf", "application/pdf")
            check("NOTA FICTICIA" in result.get("text", "").upper() and "COD 123" in result.get("text", ""), f"sparse-text PDF fallback retains native fragment and OCRs image: {result}")
            check(any("conteúdo textual parcial" in warning for warning in result.get("warnings", [])), "hybrid PDF warns when sparse native text is supplemented by OCR")

            result = read_fixture("nota-mobile-12mp.png", "image/png")
            check("NOTA FICTICIA" in result.get("text", "").upper() and "TOTAL" in result.get("text", "").upper(), f"12 MP mobile photo is processed rather than rejected: {result}")
            check(any("reduzida proporcionalmente" in warning for warning in result.get("warnings", [])), "large phone photo is downscaled with aspect ratio preserved, not cropped")

            result = read_fixture("quatro-paginas-ficticio.pdf", "application/pdf")
            check("RangeError:" in result.get("error", "") and "4 páginas" in result.get("error", "") and "3" in result.get("error", ""), f"PDF page limit fails explicitly, never silently truncates: {result}")

            errors = page.evaluate("""async () => {
              const out = {};
              for (const [key, value] of Object.entries({remote: 'https://example.com/receipt.pdf'})) {
                try { await ReceiptOCR.read(value); out[key] = 'accepted'; } catch(e) { out[key] = e.name; }
              }
              try { await ReceiptOCR.read(new Blob(['not png'], {type:'image/png'})); out.badSignature = 'accepted'; } catch(e) { out.badSignature = e.name; }
              try { await ReceiptOCR.read(new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], {type:'application/pdf'})); out.tooLarge = 'accepted'; } catch(e) { out.tooLarge = e.name; }
              const controller = new AbortController();
              const canceled = ReceiptOCR.read(new Blob([Uint8Array.from([37,80,68,70,45])], {type:'application/pdf'}), {signal:controller.signal}).then(()=> 'accepted', e=>e.name);
              controller.abort(); out.canceled = await canceled;
              return out;
            }""")
            check(errors == {"remote": "TypeError", "badSignature": "TypeError", "tooLarge": "RangeError", "canceled": "AbortError"}, f"URL, signature, byte-size and abort validation: {errors}")
            check(not blocked, f"no browser request escaped localhost: {blocked}")
            check(all(urlparse(u).hostname in ("127.0.0.1", "localhost") and urlparse(u).port == server.server_port for u in requested), "every observed browser request was loopback-only")
            check(any("pdf.worker.mjs" in u for u in requested), "PDF.js worker was served locally")
            browser.close()
        print(json.dumps({"status": "passed", "checks": checks, "requestCount": len(requested), "requests": requested, "blockedExternalRequests": blocked}, indent=2))
    finally:
        server.shutdown()
        server.server_close()

if __name__ == "__main__":
    main()
