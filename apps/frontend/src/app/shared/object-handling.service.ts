import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ObjectHandlingService {
  areObjectsEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) return true; // Same reference or both are null/undefined

    if (
      typeof obj1 !== 'object' ||
      typeof obj2 !== 'object' ||
      obj1 === null ||
      obj2 === null
    ) {
      return false; // If not objects or one of them is null
    }

    const record1 = obj1 as Record<string, unknown>;
    const record2 = obj2 as Record<string, unknown>;
    const keys1 = Object.keys(record1);
    const keys2 = Object.keys(record2);

    if (keys1.length !== keys2.length) {
      return false; // Objects have different numbers of properties
    }

    // Compare each key's value
    for (const key of keys1) {
      if (
        !keys2.includes(key) ||
        !this.areObjectsEqual(record1[key], record2[key])
      ) {
        return false;
      }
    }

    return true; // All properties match
  }
}
