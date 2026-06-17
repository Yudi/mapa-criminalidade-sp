#!/usr/bin/env python3

import argparse
import csv
import io
import json
import re
import sys
import time
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import requests


URL = "https://www.ssp.sp.gov.br/transparenciassp/Consultas.aspx"
TIME_ZONE = ZoneInfo("America/Sao_Paulo")
IML_TARGET = "ctl00$cphBody$btnIML"
YEAR_TARGET = "ctl00$cphBody$lkIML{year}"
MONTH_TARGET = "ctl00$cphBody$LinkButton{month}"
EXPORT_TARGET = "ctl00$cphBody$ExportarIMLButton"

SOURCE_COLUMNS = [
    "DataEntradaIML",
    "AnoBO",
    "NumeroBO",
    "NomeDelegaciaOrigem",
    "NumeroLaudo",
    "AnoLaudo",
    "IdadeVitima",
    "TipoIdade",
    "Conclusao",
    "DeclaracaoObito",
    "CausaMortis",
]

OUTPUT_COLUMNS = [
    "DATA_ENTRADA_IML",
    "ANO_BO",
    "NUM_BO",
    "DELEGACIA_REGISTRO",
    "NUMERO_LAUDO",
    "ANO_LAUDO",
    "IDADE_VITIMA",
    "TIPO_IDADE",
    "CONCLUSAO",
    "DECLARACAO_OBITO",
    "CAUSA_MORTIS",
    "ANO_REFERENCIA",
    "MES_REFERENCIA",
    "NUM_BO_NORMALIZED",
    "DELEGACIA_REGISTRO_NORMALIZED",
]


class HiddenFieldsParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.fields: dict[str, str] = {}

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag != "input":
            return

        attributes = dict(attrs)
        name = attributes.get("name")
        field_type = (attributes.get("type") or "").lower()
        if field_type == "hidden" and name:
            self.fields[name] = attributes.get("value") or ""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download selected months of Registro de Óbitos - IML data."
    )
    parser.add_argument("--year", required=True, type=int)
    parser.add_argument("--months", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    parser.add_argument("--timeout-seconds", type=float, default=180.0)
    return parser.parse_args()


def hidden_fields(html: str) -> dict[str, str]:
    parser = HiddenFieldsParser()
    parser.feed(html)
    return parser.fields


def normalize_lookup_value(value: str) -> str:
    without_accents = "".join(
        character
        for character in unicodedata.normalize("NFD", value)
        if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^A-Z0-9]+", " ", without_accents.upper()).strip()


def postback(
    session: requests.Session,
    html: str,
    target: str,
    timeout_seconds: float,
    extra: dict[str, str] | None = None,
) -> requests.Response:
    data = hidden_fields(html)
    data["__EVENTTARGET"] = target
    data["__EVENTARGUMENT"] = ""
    if extra:
        data.update(extra)

    response = session.post(
        URL,
        data=data,
        headers={"Referer": URL},
        timeout=(15, timeout_seconds),
    )
    response.raise_for_status()
    return response


def decode_export(content: bytes) -> list[dict[str, str]]:
    text = content.decode("utf-16-le").lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    if reader.fieldnames != SOURCE_COLUMNS:
        raise RuntimeError(
            f"Unexpected IML export columns: {reader.fieldnames!r}"
        )

    return [
        {column: (row.get(column) or "").strip() for column in SOURCE_COLUMNS}
        for row in reader
        if any((row.get(column) or "").strip() for column in SOURCE_COLUMNS)
    ]


def validate_month_rows(
    rows: list[dict[str, str]], year: int, month: int
) -> None:
    expected_suffix = f"/{month:02}/{year}"

    for row in rows:
        entry_date = row["DataEntradaIML"]
        if entry_date and expected_suffix not in entry_date[:10]:
            raise RuntimeError(
                f"Export for {year}-{month:02} contained unexpected "
                f"DataEntradaIML value: {entry_date!r}"
            )


def parse_months(value: str) -> list[int]:
    try:
        months = sorted({int(month.strip()) for month in value.split(",")})
    except ValueError as error:
        raise RuntimeError(f"Invalid month list: {value!r}") from error

    if not months or any(month < 1 or month > 12 for month in months):
        raise RuntimeError(f"Invalid month list: {value!r}")

    return months


def validate_requested_months(year: int, months: list[int]) -> None:
    current_date = datetime.now(TIME_ZONE).date()
    for month in months:
        if (year, month) > (current_date.year, current_date.month):
            raise RuntimeError(f"Cannot download future IML month {year}-{month:02}")


def scrape_months(
    year: int,
    months: list[int],
    delay_seconds: float,
    timeout_seconds: float,
) -> dict[int, list[dict[str, str]]]:
    rows_by_month: dict[int, list[dict[str, str]]] = {}

    with requests.Session() as session:
        session.headers["User-Agent"] = (
            "Mapa Criminalidade SSP-SP public data importer/1.0"
        )

        page = session.get(URL, timeout=(15, timeout_seconds))
        page.raise_for_status()
        page = postback(session, page.text, IML_TARGET, timeout_seconds)
        page = postback(
            session,
            page.text,
            YEAR_TARGET.format(year=year),
            timeout_seconds,
        )

        for month in months:
            try:
                page = postback(
                    session,
                    page.text,
                    MONTH_TARGET.format(month=month),
                    timeout_seconds,
                )
                token = str(int(time.time() * 1000))
                export = postback(
                    session,
                    page.text,
                    EXPORT_TARGET,
                    timeout_seconds,
                    {"ctl00$cphBody$hdfExport": token},
                )

                content_type = export.headers.get("Content-Type", "").lower()
                if "application/vnd.ms-excel" not in content_type:
                    raise RuntimeError(
                        f"Export for {year}-{month:02} was not an Excel response"
                    )

                month_rows = decode_export(export.content)
                validate_month_rows(month_rows, year, month)
                output_rows: list[dict[str, str]] = []
                for row in month_rows:
                    row["ANO_REFERENCIA"] = str(year)
                    row["MES_REFERENCIA"] = str(month)
                    row["NUM_BO_NORMALIZED"] = normalize_lookup_value(
                        row["NumeroBO"]
                    )
                    row["DELEGACIA_REGISTRO_NORMALIZED"] = normalize_lookup_value(
                        row["NomeDelegaciaOrigem"]
                    )
                    output_rows.append(row)

                rows_by_month[month] = output_rows
                print(
                    f"Downloaded {year}-{month:02}: {len(month_rows)} records",
                    file=sys.stderr,
                )
            except Exception as error:
                print(
                    f"Failed to download {year}-{month:02}: {error}",
                    file=sys.stderr,
                )
            finally:
                if delay_seconds > 0:
                    time.sleep(delay_seconds)

    return rows_by_month


def write_csv(output_path: Path, rows: list[dict[str, str]]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(f"{output_path.suffix}.part")

    with temporary_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.writer(
            output,
            delimiter=";",
            quotechar='"',
            quoting=csv.QUOTE_ALL,
            lineterminator="\n",
        )
        writer.writerow(OUTPUT_COLUMNS)
        for row in rows:
            writer.writerow(
                [
                    row["DataEntradaIML"],
                    row["AnoBO"],
                    row["NumeroBO"],
                    row["NomeDelegaciaOrigem"],
                    row["NumeroLaudo"],
                    row["AnoLaudo"],
                    row["IdadeVitima"],
                    row["TipoIdade"],
                    row["Conclusao"],
                    row["DeclaracaoObito"],
                    row["CausaMortis"],
                    row["ANO_REFERENCIA"],
                    row["MES_REFERENCIA"],
                    row["NUM_BO_NORMALIZED"],
                    row["DELEGACIA_REGISTRO_NORMALIZED"],
                ]
            )

    temporary_path.replace(output_path)


def main() -> None:
    args = parse_arguments()
    months = parse_months(args.months)
    validate_requested_months(args.year, months)
    rows_by_month = scrape_months(
        args.year,
        months,
        args.delay_seconds,
        args.timeout_seconds,
    )
    files = []
    for month, rows in rows_by_month.items():
        output_path = (
            args.output_dir / f"registro_obitos_iml_{args.year}_{month:02}.csv"
        )
        write_csv(output_path, rows)
        files.append(
            {
                "month": month,
                "recordCount": len(rows),
                "outputPath": str(output_path),
            }
        )

    print(
        json.dumps(
            {
                "year": args.year,
                "files": files,
            }
        )
    )


if __name__ == "__main__":
    main()
