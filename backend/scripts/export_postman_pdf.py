import json
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
COLLECTION = ROOT / "docs" / "HMS_MMA_API.postman_collection.json"
OUTPUT = ROOT / "docs" / "HMS_MMA_API_Documentation.pdf"


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def _collect_requests(items: list[dict[str, Any]], folder: str = "") -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for item in items:
        if "request" in item:
            request = item["request"]
            url = request.get("url", {})
            body = request.get("body", {})
            params = ", ".join(
                query.get("key", "")
                for query in url.get("query", [])
                if not query.get("disabled")
            )
            rows.append(
                {
                    "folder": folder,
                    "name": item.get("name", ""),
                    "method": request.get("method", ""),
                    "url": url.get("raw", ""),
                    "params": params,
                    "body": body.get("mode", "none"),
                }
            )
        else:
            child_folder = f"{folder} / {item.get('name', '')}" if folder else item.get("name", "")
            rows.extend(_collect_requests(item.get("item", []), child_folder))
    return rows


def _page_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawRightString(A4[0] - 0.55 * inch, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf() -> None:
    collection = json.loads(COLLECTION.read_text(encoding="utf-8"))
    requests = _collect_requests(collection.get("item", []))

    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "TitleCustom",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=26,
        spaceAfter=16,
    )
    h1 = ParagraphStyle(
        "HeadingCustom",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        spaceBefore=12,
        spaceAfter=8,
    )
    small = ParagraphStyle(
        "Small",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8,
        leading=10,
    )
    code = ParagraphStyle(
        "Code",
        parent=small,
        fontName="Courier",
        fontSize=7,
        leading=9,
        wordWrap="CJK",
    )

    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title="HMS MMA API Documentation",
    )

    story: list[Any] = [
        Paragraph("HMS MMA API Documentation", title),
        Paragraph(f"Source collection: {COLLECTION.name}", styles["BodyText"]),
        Paragraph(f"Total requests: {len(requests)}", styles["BodyText"]),
        Spacer(1, 0.15 * inch),
    ]

    grouped: dict[str, list[dict[str, str]]] = {}
    for request in requests:
        grouped.setdefault(request["folder"], []).append(request)

    summary_rows: list[list[Any]] = [["Folder", "Requests"]]
    for folder, rows in grouped.items():
        summary_rows.append([Paragraph(folder, small), str(len(rows))])
    summary_table = Table(summary_rows, colWidths=[6.2 * inch, 1.0 * inch], repeatRows=1)
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
            ]
        )
    )
    story.append(summary_table)
    story.append(PageBreak())

    for folder, rows in grouped.items():
        story.append(Paragraph(folder, h1))
        table_rows: list[list[Any]] = [["Method", "Name", "URL / Params", "Body"]]
        for request in rows:
            details = request["url"]
            if request["params"]:
                details += f"<br/><b>Params:</b> {request['params']}"
            table_rows.append(
                [
                    Paragraph(request["method"], small),
                    Paragraph(request["name"], small),
                    Paragraph(details.replace("&", "&amp;"), code),
                    Paragraph(request["body"], small),
                ]
            )
        table = Table(table_rows, colWidths=[0.55 * inch, 1.45 * inch, 4.6 * inch, 0.65 * inch], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#374151")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#d1d5db")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
                ]
            )
        )
        story.append(table)
        story.append(PageBreak())

    doc.build(story, onFirstPage=_page_footer, onLaterPages=_page_footer)
    print(f"Wrote {OUTPUT}")
    print(f"Requests: {len(requests)}")


if __name__ == "__main__":
    build_pdf()
