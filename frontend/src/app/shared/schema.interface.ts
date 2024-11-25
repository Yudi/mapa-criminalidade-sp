import { Geometry } from 'ol/geom';

export interface BoletimOcorrencia {
  id: number;
  nome_departamento: string | null;
  nome_seccional: string | null;
  nome_delegacia: string | null;
  cidade: string | null;
  ano_bo: number | null;
  num_bo: string | null;
  data_registro: string | null;
  data_ocorrencia_bo: string | null;
  hora_ocorrencia_bo: string | null;
  descr_periodo: string | null;
  descr_subtipolocal: string | null;
  bairro: string | null;
  logradouro: string | null;
  numero_logradouro: string | null;
  latitude: number | null;
  longitude: number | null;
  nome_delegacia_circunscricao: string | null;
  nome_departamento_circunscricao: string | null;
  nome_seccional_circunscricao: string | null;
  nome_municipio_circunscricao: string | null;
  rubrica: string | null;
  descr_conduta: string | null;
  natureza_apurada: string | null;
  mes_estatistica: number | null;
  ano_estatistica: number | null;
  location: Geometry | null;
}
