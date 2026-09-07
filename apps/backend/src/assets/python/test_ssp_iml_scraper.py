import csv
import io
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path
from types import SimpleNamespace

import ssp_iml_scraper as scraper


class SspImlScraperTest(unittest.TestCase):
    def test_export_postback_requests_a_streaming_response(self):
        calls = []

        class Response:
            def raise_for_status(self):
                return None

            def close(self):
                return None

        class Session:
            def post(self, *args, **kwargs):
                calls.append(kwargs)
                return Response()

        response = scraper.postback(
            Session(),
            '<input type="hidden" name="__VIEWSTATE" value="token">',
            "target",
            1,
            stream=True,
        )

        self.assertIsInstance(response, Response)
        self.assertTrue(calls[0]["stream"])

    def test_normalize_lookup_value_is_stable_for_accents_and_punctuation(self):
        self.assertEqual(
            scraper.normalize_lookup_value("São José d'Além!"),
            "SAO JOSE D ALEM",
        )

    def test_parse_months_sorts_and_deduplicates(self):
        self.assertEqual(scraper.parse_months(" 3, 1,3, 2 "), [1, 2, 3])
        with self.assertRaises(RuntimeError):
            scraper.parse_months("0,13")

    def test_decode_export_requires_the_expected_columns(self):
        fields = "\t".join(scraper.SOURCE_COLUMNS)
        values = "\t".join(["01/03/2026", "2026", "42"] + [""] * 8)
        content = f"{fields}\n{values}\n".encode("utf-16-le")

        response = SimpleNamespace(
            headers={"Content-Length": str(len(content))},
            iter_content=lambda chunk_size: [content],
        )
        self.assertEqual(
            list(scraper.decode_export_stream(response, len(content))),
            [
                {
                    **dict(zip(scraper.SOURCE_COLUMNS, ["01/03/2026", "2026", "42"] + [""] * 8)),
                }
            ],
        )

        with self.assertRaises(RuntimeError):
            list(
                scraper.decode_export_stream(
                    SimpleNamespace(
                        headers={},
                        iter_content=lambda chunk_size: [
                            "wrong\n".encode("utf-16-le")
                        ],
                    ),
                    1024,
                )
            )

    def test_decode_export_accepts_reordered_and_optional_columns(self):
        fields = [
            "\ufeffNumero BO",
            "Data Entrada IML",
            "AnoBO",
            "NomeDelegaciaOrigem",
            "NovaColuna",
        ]
        values = ["42", "01/03/2026", "2026", "Centro", "ignored"]
        content = ("\t".join(fields) + "\n" + "\t".join(values) + "\n").encode(
            "utf-16-le"
        )
        response = SimpleNamespace(
            headers={"Content-Length": str(len(content))},
            iter_content=lambda chunk_size: [content],
            close=lambda: None,
        )

        row = list(scraper.decode_export_stream(response, len(content)))[0]
        self.assertEqual(row["NumeroBO"], "42")
        self.assertEqual(row["DataEntradaIML"], "01/03/2026")
        self.assertEqual(row["AnoBO"], "2026")
        self.assertEqual(row["NomeDelegaciaOrigem"], "Centro")
        self.assertEqual(row["CausaMortis"], "")

    def test_decode_export_rejects_missing_required_columns(self):
        fields = ["DataEntradaIML", "AnoBO", "NumeroBO"]
        content = ("\t".join(fields) + "\n").encode("utf-16-le")
        response = SimpleNamespace(
            headers={},
            iter_content=lambda chunk_size: [content],
            close=lambda: None,
        )

        with self.assertRaisesRegex(RuntimeError, "NomeDelegaciaOrigem"):
            list(scraper.decode_export_stream(response, 1024))

    def test_decode_export_closes_after_streaming_byte_limit_failure(self):
        closed = []

        class Response:
            headers = {}

            def iter_content(self, chunk_size):
                yield b"x" * 8

            def close(self):
                closed.append(True)

        with self.assertRaisesRegex(RuntimeError, "exceeds 4 byte limit"):
            list(scraper.decode_export_stream(Response(), 4))
        self.assertEqual(closed, [True])

    def test_validate_month_rows_rejects_rows_from_another_month(self):
        row = {column: "" for column in scraper.SOURCE_COLUMNS}
        row["DataEntradaIML"] = "31/03/2026"
        scraper.validate_month_rows([row], 2026, 3)

        row["DataEntradaIML"] = "01/04/2026"
        with self.assertRaises(RuntimeError):
            scraper.validate_month_rows([row], 2026, 3)

        row["DataEntradaIML"] = "32/03/2026"
        with self.assertRaisesRegex(RuntimeError, "Invalid DataEntradaIML date"):
            scraper.validate_month_rows([row], 2026, 3)

    def test_write_csv_is_atomic_and_uses_the_public_contract(self):
        row = {column: "" for column in scraper.SOURCE_COLUMNS}
        row.update(
            {
                "DataEntradaIML": "01/03/2026",
                "AnoBO": "2026",
                "NumeroBO": "42",
                "NomeDelegaciaOrigem": "Centro",
                "ANO_REFERENCIA": "2026",
                "MES_REFERENCIA": "3",
                "NUM_BO_NORMALIZED": "42",
                "DELEGACIA_REGISTRO_NORMALIZED": "CENTRO",
            }
        )

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "out.csv"
            self.assertEqual(scraper.write_csv(output, [row]), 1)

            self.assertTrue(output.exists())
            self.assertFalse(list(Path(directory).glob("*.part")))
            with output.open(encoding="utf-8", newline="") as stream:
                records = list(csv.reader(stream, delimiter=";"))
            self.assertEqual(records[0], scraper.OUTPUT_COLUMNS)
            self.assertEqual(records[1][1:4], ["2026", "42", "Centro"])

    def test_scrape_months_skips_a_dirty_row_without_discarding_the_month(self):
        valid = {column: "" for column in scraper.SOURCE_COLUMNS}
        valid["DataEntradaIML"] = "01/03/2026"
        invalid = {**valid, "DataEntradaIML": "not-a-date"}

        class Response:
            headers = {"Content-Type": "application/vnd.ms-excel"}
            text = ""

            def raise_for_status(self):
                return None

        class Session:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def get(self, *_args, **_kwargs):
                return Response()

        original_session = scraper.requests.Session
        original_postback = scraper.postback
        original_decode = scraper.decode_export_stream
        scraper.requests.Session = Session
        scraper.postback = lambda *_args, **_kwargs: Response()
        scraper.decode_export_stream = lambda *_args, **_kwargs: iter([invalid, valid])
        try:
            with tempfile.TemporaryDirectory() as directory, redirect_stderr(io.StringIO()):
                files, failures = scraper.scrape_months(
                    2026,
                    [3],
                    0,
                    1,
                    Path(directory),
                    1024,
                )
                self.assertEqual(failures, [])
                self.assertEqual(files[0]["recordCount"], 1)
                self.assertEqual(files[0]["rejectedRows"], 1)
        finally:
            scraper.requests.Session = original_session
            scraper.postback = original_postback
            scraper.decode_export_stream = original_decode


if __name__ == "__main__":
    unittest.main()
