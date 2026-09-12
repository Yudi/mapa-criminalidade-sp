import { BadRequestException } from '@nestjs/common';
import {
  AnalysisArea,
  isValidAnalysisArea,
} from '@mapa-criminalidade/shared-types';

export function validateAnalysisArea(area: AnalysisArea): void {
  if (!isValidAnalysisArea(area)) {
    throw new BadRequestException(
      'Invalid analysis area: use a simple closed polygon (3–100 vertices) within a 10000 km² bounding box and 200 km span, or a radius from 1 to 10000 meters.'
    );
  }
}
