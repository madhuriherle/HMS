"""Printable receipt (A5 landscape slip) built from the receipt, its lines and the organisation profile."""

import io
import os

from reportlab.lib import colors
from reportlab.lib.pagesizes import A5, landscape
from reportlab.pdfgen import canvas

from core.config import settings


def amount_in_words(value) -> str:
    n = int(round(float(value or 0)))
    if n == 0:
        return "Zero Rupees Only"
    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
            "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def below100(x):
        return ones[x] if x < 20 else (tens[x // 10] + (" " + ones[x % 10] if x % 10 else ""))

    def below1000(x):
        h, r = divmod(x, 100)
        return (ones[h] + " Hundred" + (" and " if r else "") if h else "") + (below100(r) if r else "")

    parts = []
    for div, name in ((10_000_000, "Crore"), (100_000, "Lakh"), (1000, "Thousand")):
        q, n = divmod(n, div)
        if q:
            parts.append(f"{below100(q) if q < 100 else below1000(q)} {name}")
    if n:
        parts.append(below1000(n))
    return " ".join(parts) + " Rupees Only"


def _inr(v) -> str:
    return f"Rs. {float(v or 0):,.2f}"


def _period_text(receipt) -> str:
    """'15-03-2027 to 20-03-2027, 06:00 to 08:00' from whichever period fields are filled."""
    d1, d2 = receipt.period_from_date, receipt.period_to_date
    t1, t2 = receipt.period_from_time, receipt.period_to_time
    fd = lambda d: d.strftime("%d-%m-%Y") if hasattr(d, 'strftime') else str(d)
    ft = lambda t: t.strftime("%H:%M") if hasattr(t, 'strftime') else str(t)
    dates = " to ".join(fd(d) for d in (d1, d2) if d) if d1 != d2 else (fd(d1) if d1 else "")
    times = " to ".join(ft(t) for t in (t1, t2) if t)
    return ", ".join(x for x in (dates, times) if x)


def build_receipt_pdf(receipt, lines, org, payee_lines) -> bytes:
    buf = io.BytesIO()
    w, h = landscape(A5)
    c = canvas.Canvas(buf, pagesize=(w, h))
    num_str = receipt.receipt_number or f"ID-{receipt.id}"
    c.setTitle(f"Receipt {num_str}")
    maroon = colors.HexColor("#510601")
    margin = 28

    # header
    y = h - 30
    logo = getattr(org, "logo_path", None)
    if logo:
        path = logo if os.path.isfile(logo) else os.path.join(settings.UPLOAD_DIR, logo.replace("uploads/", "", 1))
        if os.path.isfile(path):
            try:
                c.drawImage(path, margin, h - 66, width=44, height=44, preserveAspectRatio=True, mask="auto")
            except Exception:
                pass
    c.setFillColor(maroon)
    c.setFont("Helvetica-Bold", 14)
    c.drawCentredString(w / 2 + 20, y, (org.name_en or "Receipt") if org else "Receipt")
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.black)
    if org:
        if org.address_en:
            c.drawCentredString(w / 2 + 20, y - 13, org.address_en.replace("\n", ", ")[:110])
        contact = "  |  ".join(x for x in (org.phone, org.mobile, org.email) if x)
        if contact:
            c.drawCentredString(w / 2 + 20, y - 24, contact[:110])
    c.setStrokeColor(maroon)
    c.line(margin, h - 72, w - margin, h - 72)

    # receipt no / date / payee
    y = h - 90
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(maroon)
    c.drawString(margin, y, f"Receipt No: {num_str}")
    date_str = receipt.receipt_date.strftime("%d-%m-%Y") if hasattr(receipt.receipt_date, "strftime") else (str(receipt.receipt_date) if receipt.receipt_date else "-")
    c.drawRightString(w - margin, y, f"Date: {date_str}")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    y -= 15
    c.drawString(margin, y, f"Received with thanks from: {receipt.payer_name or '-'}")
    for extra in payee_lines:
        y -= 12
        c.drawString(margin, y, extra)

    # lines table
    y -= 16
    c.setFillColor(colors.HexColor("#FAF7F2"))
    c.rect(margin, y - 4, w - 2 * margin, 15, fill=1, stroke=0)
    c.setFillColor(maroon)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(margin + 4, y, "No")
    c.drawString(margin + 28, y, "Particulars")
    c.drawRightString(w - margin - 4, y, "Amount")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    for i, ln in enumerate(lines, start=1):
        y -= 14
        label = ln.get("particular") or "Particular"
        if ln.get("description") and ln["description"] != ln.get("particular"):
            label += f" - {ln['description']}"
        c.drawString(margin + 4, y, str(i))
        c.drawString(margin + 28, y, label[:70])
        c.drawRightString(w - margin - 4, y, _inr(ln.get("amount", 0)))
    y -= 8
    c.line(margin, y, w - margin, y)
    y -= 14
    c.setFont("Helvetica-Bold", 10)
    c.drawString(margin + 28, y, "Total")
    c.drawRightString(w - margin - 4, y, _inr(receipt.net_amount or 0))
    y -= 14
    c.setFont("Helvetica-Oblique", 8.5)
    c.drawString(margin, y, amount_in_words(receipt.net_amount or 0))

    # payment
    y -= 16
    c.setFont("Helvetica", 9)
    pay = f"Paid by: {receipt.payment_mode or '-'}"
    if receipt.bank_account:
        pay += f" ({receipt.bank_account})"
    if receipt.transaction_reference:
        pay += f"   Ref: {receipt.transaction_reference}"
    c.drawString(margin, y, pay[:120])
    period = _period_text(receipt)
    if period:
        y -= 13
        c.drawString(margin, y, f"Period: {period}")

    # footer
    note = getattr(org, "receipt_footer_note_en", None) if org else None
    c.setFont("Helvetica", 7.5)
    c.drawString(margin, 34, (note or "Cheques are subject to realisation.")[:120])
    c.setFont("Helvetica", 8)
    c.drawRightString(w - margin, 34, "Authorised signatory")
    c.line(w - margin - 110, 46, w - margin, 46)
    if receipt.receipt_status == "CANCELLED" or receipt.payment_status == "CANCELLED":
        c.saveState()
        c.setFont("Helvetica-Bold", 48)
        c.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.25))
        c.translate(w / 2, h / 2)
        c.rotate(25)
        c.drawCentredString(0, 0, "CANCELLED")
        c.restoreState()
    c.showPage()
    c.save()
    return buf.getvalue()
