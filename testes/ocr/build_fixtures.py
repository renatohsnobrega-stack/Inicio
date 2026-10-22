"""Regenerate the synthetic receipt fixtures used by run_browser_tests.py."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdf_canvas

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font = ImageFont.truetype(font_path, 64)
image = Image.new("RGB", (1440, 900), "white")
draw = ImageDraw.Draw(image)
draw.text((90, 90), "NOTA FICTICIA", font=font, fill="black")
draw.text((90, 270), "ARROZ 2,00", font=font, fill="black")
draw.text((90, 450), "TOTAL R$ 2,00", font=font, fill="black")
image.save(OUT / "nota-ficticia.png", optimize=True)
mobile = Image.new("RGB", (4032, 3024), "white")
mobile_draw = ImageDraw.Draw(mobile)
mobile_font = ImageFont.truetype(font_path, 170)
mobile_draw.text((160, 280), "NOTA FICTICIA", font=mobile_font, fill="black")
mobile_draw.text((160, 880), "TOTAL R$ 2,00", font=mobile_font, fill="black")
mobile.save(OUT / "nota-mobile-12mp.png", optimize=True)

pdf = pdf_canvas.Canvas(str(OUT / "nota-texto-ficticia.pdf"), pagesize=letter)
pdf.setFont("Helvetica", 20)
pdf.drawString(72, 710, "PDF FICTICIO")
pdf.setFont("Helvetica", 16)
pdf.drawString(72, 670, "CAFE 1,50")
pdf.drawString(72, 635, "TOTAL 1,50")
pdf.drawString(72, 600, "COMPROVANTE FICTICIO DE TESTE AUTOMATIZADO")
pdf.drawString(72, 565, "DOCUMENTO SEM VALOR COMERCIAL OU FISCAL")
pdf.save()

pdf = pdf_canvas.Canvas(str(OUT / "nota-raster-ficticia.pdf"), pagesize=letter)
pdf.drawImage(ImageReader(image), 54, 430, width=504, height=315, preserveAspectRatio=True, mask="auto")
pdf.save()

pdf = pdf_canvas.Canvas(str(OUT / "nota-hibrida-texto-raster-ficticia.pdf"), pagesize=letter)
pdf.drawImage(ImageReader(image), 54, 430, width=504, height=315, preserveAspectRatio=True, mask="auto")
pdf.setFont("Helvetica", 10)
pdf.drawString(54, 400, "COD 123")
pdf.save()

pdf = pdf_canvas.Canvas(str(OUT / "quatro-paginas-ficticio.pdf"), pagesize=letter)
for number in range(1, 5):
    pdf.setFont("Helvetica", 18)
    pdf.drawString(72, 710, f"PAGINA FICTICIA {number}")
    pdf.showPage()
pdf.save()

# Nota inteiramente fictícia para OCR -> parser -> revisão -> ledger.
complete = Image.new('RGB', (1700, 780), 'white')
complete_draw = ImageDraw.Draw(complete)
complete_font = ImageFont.truetype(font_path, 48)
for index, line in enumerate([
    'MERCADO FICTICIO', '22/10/2026',
    'LEITE FICTICIO 2 UN X 5,50 11,00',
    'ARROZ FICTICIO 1 KG X 8,90 8,90', 'TOTAL R$ 19,90',
]):
    complete_draw.text((70, 70 + index * 130), line, font=complete_font, fill='black')
complete.save(OUT / 'nota-completa-ficticia.png', optimize=True)
