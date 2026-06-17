import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class MapMarkersService {
  markerList = [
    {
      keywords: ['consumo pessoal', 'ilícito extrapenal (tema 506 STF)'],
      icon: 'uso_drogas.png',
    },
    {
      keywords: ['129'],
      icon: 'agressao.png',
    },
    {
      keywords: ['arma'],
      icon: 'armas.png',
    },
    {
      keywords: ['Homicídio culposo na direção', '302'],
      icon: 'atropelamento_morte.png',
    },
    {
      keywords: ['Lesão corporal culposa na direção', '303', 'atropelamento'],
      icon: 'atropelamento.png',
    },
    {
      keywords: ['furto'],
      icon: 'furto.png',
    },
    {
      keywords: ['perda'],
      icon: 'perda.png',
    },
    {
      keywords: ['homicídio', '121', 'feminicídio'],
      icon: 'homicidio.png',
    },
    {
      keywords: ['roubo'],
      icon: 'roubo.png',
    },
    {
      keywords: ['tráfico drogas', 'tráfico de drogas'],
      icon: 'trafico_drogas.png',
    },
    {
      keywords: ['estelionato'],
      icon: 'estelionato.png',
    },
    {
      keywords: ['extorsao'],
      icon: 'extorsao.png',
    },
    {
      keywords: ['art. 311'],
      icon: 'adulteracao_veiculo.png',
    },
    {
      keywords: ['ameaça'],
      icon: 'ameaca.png',
    },
    {
      keywords: ['prisão', 'prisões', 'presos'],
      icon: 'prisao.png',
    },
    {
      keywords: [
        'Localização/Apreensão e Entrega de veículo',
        'Veículos Recuperados',
        'Entrega de veículo localizado/apreendido',
        'Localização/Apreensão de veículo',
      ],
      icon: 'veiculo_recuperado.png',
    },
    {
      keywords: ['dano'],
      icon: 'dano.png',
    },
    {
      keywords: ['estupro'],
      icon: 'estupro.png',
    },
    // {
    //   keywords: ['Instigação ao suicídio'],
    //   icon: 'instigacao_suicidio.png',
    // },
    // {
    //   keywords: ['suicídio consumado'],
    //   icon: 'suicidio.png',
    // },
    {
      keywords: ['outros'],
      icon: 'outros.png',
    },
  ];

  markerChooser(rubrica: string) {
    const icon = this.markerList.find((marker) => {
      return marker.keywords?.some((keyword) => {
        return normalizeString(rubrica).includes(normalizeString(keyword));
      });
    });

    return `markers/${icon?.icon || 'default.png'}`;
  }
}

function normalizeString(str: string) {
  return str
    .normalize('NFD') // Decompose accents into separate characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritic marks
    .toLowerCase();
}
