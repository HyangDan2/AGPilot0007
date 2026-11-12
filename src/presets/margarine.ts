import { AdjustmentSettings, FilmId } from '../types/film';

export interface MargarinePreset {
  id: string;
  name: string;
  category: string;
  baseFilmId: FilmId;
  version: string;
  adjustments: AdjustmentSettings;
}

// Independently authored original looks. Reference research is kept outside Git.
export const MARGARINE_PRESETS: MargarinePreset[] = [
  {
    "id": "soft-white",
    "name": "Soft White",
    "category": "Light",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": -3.0,
      "tint": 2.0,
      "highlights": -25.0,
      "shadows": 25.0,
      "contrast": -8.0,
      "saturation": -7.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cream-daylight",
    "name": "Cream Daylight",
    "category": "Light",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 12.0,
      "tint": 3.0,
      "highlights": -22.0,
      "shadows": 18.0,
      "contrast": -10.0,
      "saturation": -10.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cafe-brown",
    "name": "House Brown",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 14.0,
      "tint": 2.0,
      "highlights": -28.0,
      "shadows": 14.0,
      "contrast": -8.0,
      "saturation": -15.0,
      "filmStrength": 50.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "studio-glow",
    "name": "Studio Glow",
    "category": "Light",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.25,
      "temperature": 0.0,
      "tint": 2.0,
      "highlights": -30.0,
      "shadows": 24.0,
      "contrast": -10.0,
      "saturation": -6.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "brown-drop",
    "name": "Brown Drop",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": 10.0,
      "tint": 1.0,
      "highlights": -24.0,
      "shadows": 10.0,
      "contrast": -4.0,
      "saturation": -10.0,
      "filmStrength": 35.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "everyday-light",
    "name": "Everyday Light",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 3.0,
      "tint": 0.0,
      "highlights": -18.0,
      "shadows": 16.0,
      "contrast": -5.0,
      "saturation": -3.0,
      "filmStrength": 40.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "table-mood",
    "name": "Table Mood",
    "category": "Cafe",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 6.0,
      "tint": 2.0,
      "highlights": -36,
      "shadows": 12.0,
      "contrast": -8,
      "saturation": 0,
      "filmStrength": 30.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "storybook",
    "name": "Storybook",
    "category": "Color",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 5.0,
      "tint": 3.0,
      "highlights": -32.0,
      "shadows": 24.0,
      "contrast": -14.0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 3.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "bright-moment",
    "name": "Bright Moment",
    "category": "Light",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.3,
      "temperature": 1.0,
      "tint": 2.0,
      "highlights": -38.0,
      "shadows": 30.0,
      "contrast": -8.0,
      "saturation": -4.0,
      "filmStrength": 50.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "daily-haze",
    "name": "Daily Haze",
    "category": "Vintage",
    "baseFilmId": "FS-002",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": -3.0,
      "tint": 4.0,
      "highlights": -24.0,
      "shadows": 18.0,
      "contrast": -12.0,
      "saturation": -12.0,
      "filmStrength": 35.0,
      "grain": 2.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "maison-light",
    "name": "Maison Light",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 4.0,
      "tint": 3.0,
      "highlights": -30.0,
      "shadows": 14.0,
      "contrast": 0,
      "saturation": -8.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "all-day-soft",
    "name": "All Day Soft",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 2.0,
      "tint": 1.0,
      "highlights": -22.0,
      "shadows": 20.0,
      "contrast": -9.0,
      "saturation": -6.0,
      "filmStrength": 50.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "garden-room",
    "name": "Garden Room",
    "category": "Color",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": -2.0,
      "tint": 1.0,
      "highlights": -25.0,
      "shadows": 20.0,
      "contrast": -10.0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "autumn-caramel",
    "name": "Autumn Caramel",
    "category": "Vintage",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.05,
      "temperature": 14.0,
      "tint": 1.0,
      "highlights": -30.0,
      "shadows": 10.0,
      "contrast": 0,
      "saturation": -18.0,
      "filmStrength": 65.0,
      "grain": 4.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "quiet-scene",
    "name": "Quiet Scene",
    "category": "Portrait",
    "baseFilmId": "FS-009",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": -4.0,
      "tint": 4.0,
      "highlights": -24.0,
      "shadows": 12.0,
      "contrast": -6.0,
      "saturation": 0,
      "filmStrength": 100,
      "grain": 0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "room-light",
    "name": "Room Light",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.35,
      "temperature": 2.0,
      "tint": 1.0,
      "highlights": -40.0,
      "shadows": 38.0,
      "contrast": -10.0,
      "saturation": -8.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "sand-picnic",
    "name": "Sand Picnic",
    "category": "Nature",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 8.0,
      "tint": 2.0,
      "highlights": -32.0,
      "shadows": 22.0,
      "contrast": -12.0,
      "saturation": -10.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "ink-ivory",
    "name": "Ink & Ivory",
    "category": "Light",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": -5.0,
      "tint": 0.0,
      "highlights": -34.0,
      "shadows": 14.0,
      "contrast": 0,
      "saturation": -12.0,
      "filmStrength": 40.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "noren",
    "name": "Noren",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 16.0,
      "tint": 2.0,
      "highlights": -35.0,
      "shadows": 20.0,
      "contrast": -8.0,
      "saturation": -14.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "luminous-day",
    "name": "Luminous Day",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.25,
      "temperature": 6.0,
      "tint": 4.0,
      "highlights": -35.0,
      "shadows": 28.0,
      "contrast": -10.0,
      "saturation": -5.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "faded-frame",
    "name": "Faded Frame",
    "category": "Vintage",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.1,
      "temperature": 2.0,
      "tint": 2.0,
      "highlights": -28.0,
      "shadows": 15.0,
      "contrast": -16.0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 8.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "color-table",
    "name": "Color Table",
    "category": "Color",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": 2.0,
      "tint": 1.0,
      "highlights": -28.0,
      "shadows": 15.0,
      "contrast": 0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "social-pop",
    "name": "Social Pop",
    "category": "Color",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": -1.0,
      "tint": 3.0,
      "highlights": -42,
      "shadows": 22.0,
      "contrast": -12,
      "saturation": 0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "social-pop-ii",
    "name": "Social Pop II",
    "category": "Color",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": -3.0,
      "tint": 2.0,
      "highlights": -36.0,
      "shadows": 20.0,
      "contrast": 0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "soft-editorial",
    "name": "Soft Editorial",
    "category": "Vintage",
    "baseFilmId": "FS-002",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 0.0,
      "tint": 2.0,
      "highlights": -28.0,
      "shadows": 18.0,
      "contrast": -6.0,
      "saturation": -10.0,
      "filmStrength": 45.0,
      "grain": 3.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "white-room",
    "name": "White Room",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.25,
      "temperature": -5.0,
      "tint": 1.0,
      "highlights": -38.0,
      "shadows": 30.0,
      "contrast": -12.0,
      "saturation": -9.0,
      "filmStrength": 35.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "halo",
    "name": "Halo",
    "category": "Light",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.3,
      "temperature": 1.0,
      "tint": 3.0,
      "highlights": -42.0,
      "shadows": 28.0,
      "contrast": -16.0,
      "saturation": -10.0,
      "filmStrength": 70.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "halo-ii",
    "name": "Halo II",
    "category": "Light",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.25,
      "temperature": -2.0,
      "tint": 2.0,
      "highlights": -36.0,
      "shadows": 26.0,
      "contrast": -10.0,
      "saturation": -7.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "atelier",
    "name": "Atelier",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": -1.0,
      "tint": 4.0,
      "highlights": -32.0,
      "shadows": 18.0,
      "contrast": -8.0,
      "saturation": -8.0,
      "filmStrength": 75.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "petal-portrait",
    "name": "Petal Portrait",
    "category": "Portrait",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": 3.0,
      "tint": 5.0,
      "highlights": -36.0,
      "shadows": 22.0,
      "contrast": -14.0,
      "saturation": -10.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cold-roast",
    "name": "Cold Roast",
    "category": "Cafe",
    "baseFilmId": "FS-002",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.1,
      "temperature": -12.0,
      "tint": 1.0,
      "highlights": -38,
      "shadows": 16.0,
      "contrast": -8,
      "saturation": -15.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "clear-portrait",
    "name": "Clear Portrait",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 1.0,
      "tint": 2.0,
      "highlights": -26.0,
      "shadows": 20.0,
      "contrast": -5.0,
      "saturation": -4.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "window-portrait",
    "name": "Window Portrait",
    "category": "Portrait",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.3,
      "temperature": -2.0,
      "tint": 4.0,
      "highlights": -42.0,
      "shadows": 30.0,
      "contrast": -12.0,
      "saturation": -8.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "color-parade",
    "name": "Color Parade",
    "category": "Color",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 0.0,
      "tint": 2.0,
      "highlights": -34.0,
      "shadows": 18.0,
      "contrast": -2.0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "clean-camera",
    "name": "Clean Camera",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": -1.0,
      "tint": 0.0,
      "highlights": -22.0,
      "shadows": 12.0,
      "contrast": 0.0,
      "saturation": -2.0,
      "filmStrength": 30.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "green-picnic",
    "name": "Green Picnic",
    "category": "Nature",
    "baseFilmId": "FS-006",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": -4.0,
      "tint": 0.0,
      "highlights": -34.0,
      "shadows": 22.0,
      "contrast": -6.0,
      "saturation": 0,
      "filmStrength": 30,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "suite-light",
    "name": "Suite Light",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": 8.0,
      "tint": 3.0,
      "highlights": -32.0,
      "shadows": 18.0,
      "contrast": -6.0,
      "saturation": -10.0,
      "filmStrength": 35.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "sky-day",
    "name": "Sky Day",
    "category": "Nature",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": -6.0,
      "tint": 2.0,
      "highlights": -40.0,
      "shadows": 24.0,
      "contrast": -6.0,
      "saturation": 0.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "portrait-day",
    "name": "Portrait Day",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 2.0,
      "tint": 3.0,
      "highlights": -30.0,
      "shadows": 20.0,
      "contrast": -8.0,
      "saturation": -5.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "meadow-picnic",
    "name": "Meadow Picnic",
    "category": "Nature",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": 2.0,
      "tint": 3.0,
      "highlights": -38.0,
      "shadows": 26.0,
      "contrast": -14.0,
      "saturation": -6.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cool-veil",
    "name": "Cool Veil",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": -14.0,
      "tint": 5.0,
      "highlights": -34.0,
      "shadows": 20.0,
      "contrast": -8.0,
      "saturation": -10.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "warm-veil",
    "name": "Warm Veil",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 18.0,
      "tint": 2.0,
      "highlights": -34.0,
      "shadows": 20.0,
      "contrast": -8.0,
      "saturation": -10.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "old-caf",
    "name": "Old Café",
    "category": "Vintage",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.1,
      "temperature": 10.0,
      "tint": 0.0,
      "highlights": -34.0,
      "shadows": 18.0,
      "contrast": 0,
      "saturation": -20.0,
      "filmStrength": 70.0,
      "grain": 5.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "morning-bake",
    "name": "Morning Bake",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 12.0,
      "tint": 1.0,
      "highlights": -30.0,
      "shadows": 18.0,
      "contrast": -8.0,
      "saturation": -12.0,
      "filmStrength": 40.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "daily-brown",
    "name": "Daily Brown",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.05,
      "temperature": 9.0,
      "tint": 2.0,
      "highlights": -26.0,
      "shadows": 16.0,
      "contrast": -6.0,
      "saturation": -10.0,
      "filmStrength": 50.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "vanilla-brown",
    "name": "Vanilla Brown",
    "category": "Cafe",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 16.0,
      "tint": 3.0,
      "highlights": -30.0,
      "shadows": 20.0,
      "contrast": -14.0,
      "saturation": -16.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "soft-biscuit",
    "name": "Soft Biscuit",
    "category": "Cafe",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": 10.0,
      "tint": 4.0,
      "highlights": -34.0,
      "shadows": 24.0,
      "contrast": -16.0,
      "saturation": -14.0,
      "filmStrength": 70.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "warm-beige",
    "name": "Warm Beige",
    "category": "Cafe",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 12.0,
      "tint": 2.0,
      "highlights": -34.0,
      "shadows": 20.0,
      "contrast": -10.0,
      "saturation": -18.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "teddy-brown",
    "name": "Teddy Brown",
    "category": "Cafe",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 18.0,
      "tint": 3.0,
      "highlights": -34.0,
      "shadows": 24.0,
      "contrast": -12.0,
      "saturation": -14.0,
      "filmStrength": 55.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "milk-caramel",
    "name": "Milk Caramel",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.1,
      "temperature": 18.0,
      "tint": 1.0,
      "highlights": -38.0,
      "shadows": 16.0,
      "contrast": 0,
      "saturation": -18.0,
      "filmStrength": 65.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "caf-latte",
    "name": "Café Latte",
    "category": "Cafe",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 14.0,
      "tint": 2.0,
      "highlights": -32.0,
      "shadows": 22.0,
      "contrast": -14.0,
      "saturation": -18.0,
      "filmStrength": 45.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "dark-cappuccino",
    "name": "Dark Cappuccino",
    "category": "Cafe",
    "baseFilmId": "FS-003",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.15,
      "temperature": 8.0,
      "tint": 0.0,
      "highlights": -42.0,
      "shadows": 12.0,
      "contrast": 0,
      "saturation": -16.0,
      "filmStrength": 70.0,
      "grain": 2.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "backlight",
    "name": "Backlight",
    "category": "Light",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.25,
      "temperature": 0.0,
      "tint": 1.0,
      "highlights": -48.0,
      "shadows": 45.0,
      "contrast": -12.0,
      "saturation": -8.0,
      "filmStrength": 35.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "terrace",
    "name": "Terrace",
    "category": "Cafe",
    "baseFilmId": "FS-005",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.15,
      "temperature": 4.0,
      "tint": 2.0,
      "highlights": -34.0,
      "shadows": 24.0,
      "contrast": -6.0,
      "saturation": -5.0,
      "filmStrength": 40.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "offbeat",
    "name": "Offbeat",
    "category": "Vintage",
    "baseFilmId": "FS-009",
    "version": "1.0.0",
    "adjustments": {
      "exposure": -0.15,
      "temperature": -6.0,
      "tint": 3.0,
      "highlights": -40,
      "shadows": 12.0,
      "contrast": -4,
      "saturation": 0,
      "filmStrength": 100,
      "grain": 0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "first-page",
    "name": "First Page",
    "category": "Portrait",
    "baseFilmId": "FS-004",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 0.0,
      "tint": 4.0,
      "highlights": -32.0,
      "shadows": 16.0,
      "contrast": 0,
      "saturation": -10.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cherry-evening",
    "name": "Cherry Evening",
    "category": "Nature",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.1,
      "temperature": 6.0,
      "tint": 9.0,
      "highlights": -36.0,
      "shadows": 22.0,
      "contrast": -12.0,
      "saturation": -10.0,
      "filmStrength": 60.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  },
  {
    "id": "cherry-bloom",
    "name": "Cherry Bloom",
    "category": "Nature",
    "baseFilmId": "FS-007",
    "version": "1.0.0",
    "adjustments": {
      "exposure": 0.2,
      "temperature": 3.0,
      "tint": 12.0,
      "highlights": -40.0,
      "shadows": 26.0,
      "contrast": -16.0,
      "saturation": -8.0,
      "filmStrength": 70.0,
      "grain": 0.0,
      "sharpness": 0,
      "vignette": 0
    }
  }
];

export function getMargarinePreset(id?: string | null) {
  return MARGARINE_PRESETS.find(preset => preset.id === id);
}
