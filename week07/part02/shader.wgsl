struct Uniforms {
  mvp: mat4x4f,
  mtex: mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>;

struct VSOut {
  @builtin(position) position: vec4f,
  @location(0) texVec: vec4f,
}

@vertex
fn main_vs(@location(0) inPos: vec3f) -> VSOut {
  var out: VSOut;

  // input position as homogeneous point
  let p = vec4f(inPos, 1.0);

  // clip-space position
  out.position = uniforms.mvp * p;

  // sphere: identity mtex -> direction ~= normal
  // background: mtex maps clip -> view -> world direction
  out.texVec = uniforms.mtex * p;

  return out;
}

@fragment
fn main_fs(@location(0) texVec: vec4f) -> @location(0) vec4f {
  // use xyz as direction; for background we need a perspective divide
  var dir = texVec.xyz;

  // handle w safely (works for both sphere and background)
  if (texVec.w != 0.0) {
    dir = dir / texVec.w;
  }

  // sample cubemap with normalized direction
  dir = normalize(dir);
  return textureSample(cubeMap, mySampler, dir);
}
