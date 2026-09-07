#!/usr/bin/env python3

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from tempfile import SpooledTemporaryFile
from uuid import uuid4
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

DEFAULT_MAX_EXPORT_BYTES = 128 * 1024 * 1024

REQUIRED_SOURCE_COLUMNS = {
    "DataEntradaIML",
    "AnoBO",
    "NumeroBO",
    "NomeDelegaciaOrigem",
}


def normalize_source_header(value: str) -> str:
    without_accents = "".join(
        character
        for character in unicodedata.normalize("NFD", value)
        if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^A-Z0-9]+", "", without_accents.upper())


SOURCE_COLUMN_BY_NORMALIZED = {
    normalize_source_header(column): column for column in SOURCE_COLUMNS
}


def map_source_headers(fieldnames: list[str | None]) -> tuple[dict[str, int], list[str]]:
    indexes: dict[str, int] = {}
    unknown: list[str] = []
    for index, raw_fieldname in enumerate(fieldnames):
        fieldname = (raw_fieldname or "").lstrip("\ufeff").strip()
        canonical = SOURCE_COLUMN_BY_NORMALIZED.get(
            normalize_source_header(fieldname)
        )
        if canonical is None:
            if fieldname:
                unknown.append(fieldname)
            continue
        if canonical in indexes:
            raise RuntimeError(
                f"IML export contains duplicate compatible column: {canonical}"
            )
        indexes[canonical] = index

    missing = sorted(REQUIRED_SOURCE_COLUMNS.difference(indexes))
    if missing:
        raise RuntimeError(
            f"IML export is missing required columns: {', '.join(missing)}"
        )
    return indexes, unknown


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
    parser.add_argument(
        "--max-response-bytes", type=int, default=DEFAULT_MAX_EXPORT_BYTES
    )
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


def close_response(response: requests.Response) -> None:
    close = getattr(response, "close", None)
    if callable(close):
        close()


def postback(
    session: requests.Session,
    html: str,
    target: str,
    timeout_seconds: float,
    extra: dict[str, str] | None = None,
    stream: bool = False,
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
        stream=stream,
    )
    try:
        response.raise_for_status()
    except Exception:
        close_response(response)
        raise
    return response


def decode_export_stream(
    response: requests.Response, max_response_bytes: int
):
    try:
        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                declared_length = int(content_length)
            except ValueError as error:
                raise RuntimeError(
                    "Export response has an invalid Content-Length"
                ) from error
            if declared_length > max_response_bytes:
                raise RuntimeError(
                    f"Export response exceeds {max_response_bytes} byte limit"
                )

        total_size = 0
        with SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b") as raw:
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                total_size += len(chunk)
                if total_size > max_response_bytes:
                    raise RuntimeError(
                        f"Export response exceeds {max_response_bytes} byte limit"
                    )
                raw.write(chunk)
            raw.seek(0)
            text = io.TextIOWrapper(raw, encoding="utf-16-le", newline="")
            reader = csv.reader(text, delimiter="\t")
            fieldnames = next(reader, None)
            if not fieldnames:
                raise RuntimeError("IML export has no header row")
            header_indexes, unknown_headers = map_source_headers(fieldnames)
            if unknown_headers:
                print(
                    "Ignoring unknown IML export columns: "
                    + ", ".join(unknown_headers),
                    file=sys.stderr,
                )
            for values in reader:
                normalized = {
                    column: (
                        values[index].strip()
                        if index < len(values)
                        else ""
                    )
                    for column, index in header_indexes.items()
                }
                normalized = {
                    column: normalized.get(column, "") for column in SOURCE_COLUMNS
                }
                if any(normalized.values()):
                    yield normalized
    finally:
        close_response(response)


def parse_entry_date(value: str) -> datetime | None:
    value = value.strip()
    if not value:
        return None

    for date_format in (
        "%d/%m/%Y",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
    ):
        try:
            return datetime.strptime(value, date_format)
        except ValueError:
            continue
    raise ValueError(f"Invalid DataEntradaIML date: {value!r}")


def entry_date_matches_month(value: str, year: int, month: int) -> bool:
    parsed = parse_entry_date(value)
    return parsed is None or (parsed.year == year and parsed.month == month)


def validate_month_rows(
    rows: list[dict[str, str]], year: int, month: int
) -> None:
    for row in rows:
        entry_date = row["DataEntradaIML"]
        try:
            matches_month = entry_date_matches_month(entry_date, year, month)
        except ValueError as error:
            raise RuntimeError(str(error)) from error
        if not matches_month:
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
    output_dir: Path,
    max_response_bytes: int,
) -> tuple[list[dict[str, int | str]], list[str]]:
    files: list[dict[str, int | str]] = []
    failures: list[str] = []

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
                    stream=True,
                )
                try:
                    content_type = export.headers.get("Content-Type", "").lower()
                    if "application/vnd.ms-excel" not in content_type:
                        raise RuntimeError(
                            f"Export for {year}-{month:02} was not an Excel response"
                        )

                    output_path = (
                        output_dir / f"registro_obitos_iml_{year}_{month:02}.csv"
                    )
                    rejected_rows = 0

                    def output_rows():
                        nonlocal rejected_rows
                        for row in decode_export_stream(export, max_response_bytes):
                            entry_date = row["DataEntradaIML"]
                            try:
                                matches_month = entry_date_matches_month(
                                    entry_date, year, month
                                )
                            except ValueError as error:
                                matches_month = False
                                reason = str(error)
                            else:
                                reason = (
                                    f"unexpected DataEntradaIML {entry_date!r}"
                                )
                            if not matches_month:
                                rejected_rows += 1
                                print(
                                    f"Skipping invalid row from {year}-{month:02}: {reason}",
                                    file=sys.stderr,
                                )
                                continue
                            row["ANO_REFERENCIA"] = str(year)
                            row["MES_REFERENCIA"] = str(month)
                            row["NUM_BO_NORMALIZED"] = normalize_lookup_value(
                                row["NumeroBO"]
                            )
                            row["DELEGACIA_REGISTRO_NORMALIZED"] = normalize_lookup_value(
                                row["NomeDelegaciaOrigem"]
                            )
                            yield row

                    record_count = write_csv(output_path, output_rows())
                    files.append(
                        {
                            "month": month,
                            "recordCount": record_count,
                            "rejectedRows": rejected_rows,
                            "outputPath": str(output_path),
                        }
                    )
                    print(
                        f"Downloaded {year}-{month:02}: {record_count} records",
                        file=sys.stderr,
                    )
                finally:
                    close_response(export)
            except Exception as error:
                failures.append(f"{year}-{month:02}: {error}")
                print(
                    f"Failed to download {year}-{month:02}: {error}",
                    file=sys.stderr,
                )
            finally:
                if delay_seconds > 0:
                    time.sleep(delay_seconds)

    return files, failures


def write_csv(output_path: Path, rows) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(
        f"{output_path.name}.{os.getpid()}.{uuid4().hex}.part"
    )

    record_count = 0
    try:
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
                record_count += 1
            output.flush()
            os.fsync(output.fileno())
        temporary_path.replace(output_path)
        return record_count
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def main() -> None:
    args = parse_arguments()
    months = parse_months(args.months)
    validate_requested_months(args.year, months)
    files, failures = scrape_months(
        args.year,
        months,
        args.delay_seconds,
        args.timeout_seconds,
        args.output_dir,
        max(1, args.max_response_bytes),
    )
    result = {
        "year": args.year,
        "status": "partial" if failures else "complete",
        "expectedMonths": len(months),
        "succeededMonths": len(files),
        "failedMonths": failures,
        "files": files,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
