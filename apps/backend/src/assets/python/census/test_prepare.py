import csv
import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from prepare import number, total, read_aggregates


class CensusPreparationTests(unittest.TestCase):
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
