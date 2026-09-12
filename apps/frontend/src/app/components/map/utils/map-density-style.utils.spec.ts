import Feature from 'ol/Feature';
import { createDensityStyleFunction } from './map-density-style.utils';

describe('density count scale', () => {
  it('keeps the same count color at different zooms and exposes exact counts close up', () => {
    const style = createDensityStyleFunction();
    const feature = new Feature({ occurrence_count: 52 });
    const distantColor = style(feature, 100).getFill()?.getColor();
    expect(distantColor).toBe('rgb(66 146 198 / 68%)');
    expect(style(feature, 100).getText()?.getText()).toBe('');
    expect(style(feature, 2).getFill()?.getColor()).toBe(distantColor);
    expect(style(feature, 2).getText()?.getText()).toBe('52');
    expect(
      style(new Feature({ occurrence_count: 2 }), 2)
        .getFill()
        ?.getColor()
    ).not.toBe(distantColor);
  });
});
