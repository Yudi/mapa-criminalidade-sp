import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from urllib.request import Request
from prepare import (
    MAX_REDIRECTS,
    ValidatingRedirectHandler,
    download,
    number,
    read_aggregates,
    total,
    validate_download_url,
)


class CensusPreparationTests(unittest.TestCase):
    @patch(
        'prepare.socket.getaddrinfo',
        return_value=[(None, None, None, None, ('127.0.0.1', 443))],
    )
    def test_download_host_must_resolve_to_public_addresses(self, _getaddrinfo):
        with self.assertRaisesRegex(ValueError, 'non-public address'):
            validate_download_url('https://ftp.ibge.gov.br/source.zip')

    def test_redirects_cannot_change_protocol_or_host(self):
        handler = ValidatingRedirectHandler()
        request = Request('https://ftp.ibge.gov.br/source.zip')
        with self.assertRaisesRegex(ValueError, 'protocol is not allowed'):
            handler.redirect_request(
                request, None, 302, 'Found', {}, 'http://127.0.0.1/metadata'
            )
        with self.assertRaisesRegex(ValueError, 'host is not allowed'):
            handler.redirect_request(
                request, None, 302, 'Found', {}, 'https://example.com/metadata'
            )
        with self.assertRaisesRegex(ValueError, f'Exceeded {MAX_REDIRECTS}'):
            handler.redirects = MAX_REDIRECTS
            handler.redirect_request(request, None, 302, 'Found', {}, 'https://ftp.ibge.gov.br/again')

    @patch('prepare.validate_download_url', side_effect=lambda url: url)
    @patch('prepare.assert_free_space')
    @patch('prepare.MAX_DOWNLOAD_BYTES', 4)
    def test_download_rejects_stream_over_byte_limit_and_removes_partial_file(
        self, _free_space, _validate
    ):
        class Response(io.BytesIO):
            headers = {}

            def geturl(self):
                return 'https://ftp.ibge.gov.br/source.zip'

        class Opener:
            def open(self, request, timeout):
                return Response(b'12345')

        with tempfile.TemporaryDirectory() as temporary, patch(
            'prepare.urllib.request.build_opener', return_value=Opener()
        ):
            path = Path(temporary) / 'source.zip'
            with self.assertRaisesRegex(ValueError, 'exceeds 4 byte limit'):
                download('https://ftp.ibge.gov.br/source.zip', path, [])
            self.assertFalse(path.exists())

    def test_suppression_is_never_zero(self):
        for raw in ['X', 'x', '.', '..', '...', '']:
            self.assertIsNone(number(raw))
        self.assertEqual(number('-'), 0)
        self.assertEqual(number('0'), 0)
        self.assertEqual(number('1234,50'), 1234.5)
        with self.assertRaises(ValueError):
            number('unexpected')

    def test_partial_sums_remain_unknown(self):
        self.assertIsNone(total({'A': '10', 'B': 'X'}, ['A', 'B']))
        self.assertEqual(total({'A': '10', 'B': '0'}, ['A', 'B']), 10)

    def test_national_csv_keeps_only_sp_and_selected_columns(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'source.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('data.csv', 'CD_BAIRRO;V01007;V01006;UNUSED\n3507100013;10;20;huge\n3300000001;30;60;discard\n')
            spec = dict(key='men', group='Demografia', label='Homens', unit='count', variables=['V01007'], denominator=['V01006'])
            rows = list(read_aggregates(path, 'neighborhood', [spec], 'https://ftp.ibge.gov.br/source.zip'))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][0], '3507100013')
            self.assertEqual(rows[0][1][0]['value'], 10)
            self.assertNotIn('UNUSED', rows[0][1][0])


if __name__ == '__main__':
    unittest.main()
