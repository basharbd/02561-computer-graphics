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
  let p = vec4f(inPos, 1.0);
  out.position = uniforms.mvp * p;
  out.texVec   = uniforms.mtex * p;   // sphere: identity => normal ; background: M_tex => direction
  return out;
}

@fragment
fn main_fs(@location(0) texVec: vec4f) -> @location(0) vec4f {
  var dir = texVec.xyz;

  // perspective divide for background (safe for both)
  if (texVec.w != 0.0) {
    dir = dir / texVec.w;
  }

  dir = normalize(dir);

  return textureSample(cubeMap, mySampler, dir);
}
