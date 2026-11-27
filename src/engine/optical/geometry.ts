import {
  geometryToSource,
  rotatedAspect,
  sourceToGeometry,
} from '../contracts/geometryMappings';
import {
  normalizeGeometry,
  validateGeometry,
  type GeometryTransform,
} from '../contracts/geometry';

export interface GeometryUniforms {
  rotation: number;
  straighten: number;
  aspect: number;
  flip: readonly [number, number];
  crop: readonly [number, number, number, number];
}

/** Output NIS -> source NIS. The CPU mirror of the GPU chunk below. */
export function geometryOutputToSource(
  point: { x: number; y: number },
  geometry: GeometryTransform,
  sourceAspect: number,
): { x: number; y: number } {
  return geometryToSource(point, normalizeGeometry(geometry), sourceAspect);
}

/** Source NIS -> output NIS, used to place masks and overlays on the source. */
export function geometrySourceToOutput(
  point: { x: number; y: number },
  geometry: GeometryTransform,
  sourceAspect: number,
): { x: number; y: number } {
  return sourceToGeometry(point, normalizeGeometry(geometry), sourceAspect);
}

export function validateGeometryRenderable(value: unknown): GeometryTransform {
  validateGeometry(value);
  const normalized = normalizeGeometry(value as Partial<GeometryTransform> | null);
  const corners = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  for (const corner of corners) {
    const source = geometryToSource(corner, normalized, 1);
    if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) {
      throw new Error('Geometry mapping is not finite at the image boundary');
    }
  }
  return normalized;
}

export function geometryUniforms(geometry: GeometryTransform, sourceAspect: number): GeometryUniforms {
  const normalized = normalizeGeometry(geometry);
  const crop = normalized.crop;
  return {
    rotation: normalized.rotation,
    straighten: normalized.straighten,
    aspect: rotatedAspect(normalized.rotation, sourceAspect),
    flip: [normalized.flipHorizontal ? 1 : 0, normalized.flipVertical ? 1 : 0],
    crop: crop ? [crop.x, crop.y, crop.width, crop.height] : [0, 0, 0, 0],
  };
}

/**
 * GLSL ES 3.00 inverse mapping for the frozen geometryMappings order:
 * source pixels are flipped, quarter-turned, straightened, then cropped, so a
 * sampling shader walks the output back through crop -> straighten -> rotate ->
 * flip. Uniforms match GeometryUniforms one-to-one.
 */
export const GEOMETRY_SHADER_CHUNK = /* glsl */ `
uniform float u_q02_geometry_rotation;
uniform float u_q02_geometry_straighten;
uniform float u_q02_geometry_aspect;
uniform vec2 u_q02_geometry_flip;
uniform vec4 u_q02_geometry_crop;

const float Q02_GEOMETRY_EPSILON = 1e-6;
const float Q02_PI = 3.141592653589793;

vec2 q02_geometry_output_to_source(vec2 uv) {
  vec2 p = uv;
  if (u_q02_geometry_crop.z > 0.0) {
    p = vec2(p.x * u_q02_geometry_crop.z + u_q02_geometry_crop.x,
             p.y * u_q02_geometry_crop.w + u_q02_geometry_crop.y);
  }
  if (abs(u_q02_geometry_straighten) > Q02_GEOMETRY_EPSILON) {
    float radians = u_q02_geometry_straighten * Q02_PI / 180.0;
    float c = cos(radians);
    float s = sin(radians);
    float scale = max(abs(c) + abs(s) / u_q02_geometry_aspect,
                      u_q02_geometry_aspect * abs(s) + abs(c));
    float x = (p.x - 0.5) * u_q02_geometry_aspect;
    float y = p.y - 0.5;
    p = vec2((c * x + s * y) / scale / u_q02_geometry_aspect + 0.5,
             (-s * x + c * y) / scale + 0.5);
  }
  if (u_q02_geometry_rotation == 90.0) {
    p = vec2(p.y, 1.0 - p.x);
  } else if (u_q02_geometry_rotation == 180.0) {
    p = vec2(1.0 - p.x, 1.0 - p.y);
  } else if (u_q02_geometry_rotation == 270.0) {
    p = vec2(1.0 - p.y, p.x);
  }
  if (u_q02_geometry_flip.x > 0.5) p.x = 1.0 - p.x;
  if (u_q02_geometry_flip.y > 0.5) p.y = 1.0 - p.y;
  return p;
}
`;
