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
      keywords: ['Lesão corporal culposa na direção', '303'],
      icon: 'atropelamento.png',
    },
    {
      keywords: ['furto'],
      icon: 'furto.png',
    },
    {
      keywords: ['homicídio', '121'],
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
  ];

  markerChooser(rubrica: string) {
    const icon = this.markerList.find((marker) => {
      return marker.keywords.some((keyword) => {
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
