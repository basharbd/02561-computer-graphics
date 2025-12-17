struct Uniforms {
  mvp: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) n_world: vec3<f32>,
};

@vertex
fn main_vs(@location(0) inPos: vec3<f32>) -> VSOut {
  var out: VSOut;
  out.position = uniforms.mvp * vec4<f32>(inPos, 1.0);

  // For a unit sphere centered at origin with identity model matrix:
  // position direction == normal direction (world space)
  out.n_world = inPos;
  return out;
}

@fragment
fn main_fs(@location(0) n_world: vec3<f32>) -> @location(0) vec4<f32> {
  // Using the world normal directly as the lookup vector
  let dir = normalize(n_world);
  return textureSample(cubeMap, mySampler, dir);
}