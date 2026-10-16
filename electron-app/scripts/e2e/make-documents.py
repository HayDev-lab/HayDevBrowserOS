"""Deterministic synthetic document corpus, no personal documents."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from docx import Document
from pypdf import PdfReader, PdfWriter
from PIL import Image
import sys

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
font = Path('C:/Windows/Fonts/sylfaen.ttf')
pdfmetrics.registerFont(TTFont('FixtureUnicode', str(font)))
lines = ['HayDev synthetic document', 'Город: Москва. Сумма: 7319 AMD.', 'Քաղաք: Երևան։ Գումար: 7319 AMD։', 'Item | Quantity | Total', 'Copper | 3 | 7319 AMD']
c = canvas.Canvas(str(out/'multilingual.pdf'), invariant=True)
c.setFont('FixtureUnicode', 13)
for i, line in enumerate(lines): c.drawString(40, 780-i*28, line)
c.save()
d = Document()
for line in lines[:3]: d.add_paragraph(line)
table = d.add_table(rows=2, cols=3)
for row, values in zip(table.rows, [['Item','Quantity','Total'],['Copper','3','7319 AMD']]):
    for cell, value in zip(row.cells, values): cell.text=value
d.save(out/'multilingual.docx')
c = canvas.Canvas(str(out/'empty.pdf'), invariant=True); c.showPage(); c.save()
c = canvas.Canvas(str(out/'scan.pdf'), invariant=True)
c.drawImage(ImageReader(Image.new('RGB',(100,100),'gray')),40,600,100,100); c.save()
writer=PdfWriter(); writer.append(PdfReader(out/'multilingual.pdf')); writer.encrypt('synthetic-fixture-password')
with (out/'protected.pdf').open('wb') as f: writer.write(f)
(out/'corrupt.pdf').write_bytes(b'%PDF-1.7\ninvalid fixture')
(out/'corrupt.docx').write_bytes(b'PK\x03\x04invalid fixture')
print('Synthetic document corpus created')
