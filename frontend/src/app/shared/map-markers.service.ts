import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class MapMarkersService {
  /*
  frontend/publicuso_drogas.png frontend/publicagressao.png frontend/publicarmas.png frontend/publicatropelamento_morte.png frontend/publicatropelamento.png frontend/publicfurto.png frontend/publichomicidio.png frontend/publicroubo.png frontend/publictrafico.png
  */
  markerList = [
    {
      keywords: ['consumo pessoal'],
      icon: 'uso_drogas.png',
    },
    {
      keywords: ['lesão corporal'],
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
      icon: 'trafico.png',
    },
  ];

  markerChooser(rubrica: string) {
    // Consider rubrica as "Posse ou porte ilegal de arma de fogo de uso restrito"

    // Find the icon that matches the rubrica
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
