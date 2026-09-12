import { FeatureLike } from 'ol/Feature';
import { Fill, Stroke, Style, Text } from 'ol/style';

// Fixed count bands: zooming/panning cannot rescale the same count's color.
export const DENSITY_BANDS = [
  {
    label: '1-9',
    min: 1,
    max: 9,
    color: 'rgb(222 235 247 / 68%)',
    foreground: '#102a43',
  },
  {
    label: '10-49',
    min: 10,
    max: 49,
    color: 'rgb(158 202 225 / 68%)',
    foreground: '#102a43',
  },
  {
    label: '50-199',
    min: 50,
    max: 199,
    color: 'rgb(66 146 198 / 68%)',
    foreground: '#082033',
  },
  {
    label: '200-999',
    min: 200,
    max: 999,
    color: 'rgb(8 81 156 / 68%)',
    foreground: '#ffffff',
  },
  {
    label: '1.000+',
    min: 1000,
    max: Infinity,
    color: 'rgb(8 48 107 / 68%)',
    foreground: '#ffffff',
  },
] as const;

export function createDensityStyleFunction(): (
  feature: FeatureLike,
  resolution: number
) => Style {
  const styles = DENSITY_BANDS.map(
    (band) =>
      new Style({
        fill: new Fill({ color: band.color }),
        stroke: new Stroke({ color: '#ffffff', width: 1 }),
        text: new Text({
          font: '600 12px sans-serif',
          fill: new Fill({ color: band.foreground }),
          overflow: false,
        }),
      })
  );
  const hidden = new Style({});
  return (feature, resolution) => {
    const count = Number(feature.get('occurrence_count'));
    if (!Number.isFinite(count) || count < 1) return hidden;
    const index = DENSITY_BANDS.findIndex((band) => count <= band.max);
    const style = styles[index];
    style
      .getText()
      ?.setText(resolution < 10 ? count.toLocaleString('pt-BR') : '');
    return style;
  };
}
